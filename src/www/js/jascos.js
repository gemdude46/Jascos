'use strict'

function Jascos (screen, storagepf) {
	storagepf = storagepf == undefined ? 'Jascos' : storagepf;
	
	function lsget(item) {
		return JSON.parse('' + localStorage.getItem(storagepf + item));
	}

	function lsset(item, value) {
		localStorage.setItem(storagepf + item, JSON.stringify(value));
	}

	if (!lsget('FS')) {
		let xhr = new XMLHttpRequest();
		xhr.open('GET', '../data/default-filesystem.json', false);
		xhr.send(null);
		localStorage.setItem(storagepf + 'FS', xhr.responseText);
	}

	const ctx = screen.getContext('2d');
	
	function minified(js) {
		js = ''+js;
		js = js.replace(/\n\s+/g, '\n');
		return js;
	}

	const prelude = minified`
		'use strict'
		
		var _response_listeners = {}, _interrupt_handlers = {};
		addEventListener('message', message => {
			message = message.data;
			if (message.type === 'action') {
				if (message.action === 'run') {
					setTimeout( () => self.main(message.args, message.pid), 1);
				}
			} else if (message.type === 'response' && _response_listeners[message.code]) {
				let f = _response_listeners[message.code];
				delete _response_listeners[message.code];
				f(message);
			} else if (message.type === 'interrupt' && _interrupt_handlers[message.sig]) {
				_interrupt_handlers[message.sig](message);
			}
		});
		function onresponse(code, cb) {
			_response_listeners[code] = cb;
		}
		function handleinterrupt(sig, cb) {
			_interrupt_handlers[sig] = cb;
		}
	`;

	/* Convert a string to a data URI.
	 *
	 * @argument data : string : The data to convert to a URI.
	 * @argument mimetype="text/plain" : string : The mimetype of the data.
	 *
	 * @returns string : The data URI.
	 */
	function dataURI(data, mimetype) {
		mimetype = mimetype || 'text/plain';

		return `data:${ mimetype };base64,${ btoa(data) }`;
	}
	
	// A pipe for piping data.
	class Pipe {
		constructor() {
			this.data = "";
		}

		write(data) {
			this.data += data;

			if ('ondata' in this) {
				this.ondata();
			}
		}

		read(amount) {
			if (amount < 0) {
				let data = this.data;
				this.data = "";
				return data;
			} else {
				let data = this.data.substring(0, amount);
				this.data = this.data.substring(amount);
				return data;
			}
		}

		poll() {
			return !!this.data;
		}
	}

	function pathSplit(path) {
		if (path.startsWith('/')) {
			return path.substring(1).split('/');
		}
	}

	/* An object representing a file that has been read.
	 *
	 * @argument content : string : The content of the file.
	 */
	class ReadFile {
		constructor(content) {
			this.content = content;
		}
	}
	
	/* The enum of file types
	 *
	 * FILE: A regular file.
	 * DIRECTORY: A directory.
	 */
	const filetypes = Object.freeze({
		FILE: 1,
		DIRECTORY: 2
	});

	/* The enum of filesystem errors
	 *
	 * NOT_FOUND: The file doesn't exist.
	 * PERMISSION_DENIED: You do not have permission to do that.
	 * INVALID_OPERATION: The file doesn't support the attempted operation.
	 * IS_DIRECTORY: The file you requested is a directory, which isn't what you wanted.
	 * IS_FILE: The file you requested is a regular file, which isn't what you wanted.
	 */
	const fserrors = Object.freeze({
		NOT_FOUND: 1,
		PERMISSION_DENIED: 2,
		INVALID_OPERATION: 3,
		IS_DIRECTORY: 4,
		iS_FILE: 5
	});
	
	/* Abstract base class for filesystems.
	 *
	 * Subclasses should implement:
	 * constructor( ... )
	 * Promise getFileInt(string[])
	 */
	class Filesystem {
		constructor() {
			if (this.constructor === Filesystem) {
				throw TypeError('Illegal construction of abstract class Filesystem.');
			}
		}

		/* Read a file.
		 *
		 * @argument path : string : The path to the file.
		 * @argument allowed_types : filetype : The allowed types of the file. May be multiple types OR'd together.
		 *
		 * @returns Promise : A promise that will resolve to a ReadFile or reject to a fserror.
		 */
		getFile(path, allowed_types) {
			return this.getFileInt(pathSplit(path), allowed_types);
		}
	}
	
	/* Filesystem that is saved to localStorage.
	 * 
	 * @argument name : string : Name of the filesystem and the key it uses in localStorage.
	 */
	class LSFilesystem extends Filesystem {
		constructor(name) {
			super();
			this.name = name;
			this.root = lsget(name);
		}

		save() {
			lsset(this.name, this.root);
		}

		getFileInt(path, allowed_types) {
			path = path.slice();
			return new Promise( (resolve, reject) => {
				let cd = this.root;
				while (path.length) {
					if ('$'+path[0] in cd) {
						cd = cd['$'+path[0]];
						if (path.length > 1 && typeof(cd) !== 'object') {
							return reject(fserrors.NOT_FOUND);
						}
						path.splice(0, 1);
					} else {
						return reject(fserrors.NOT_FOUND);
					}
				}
				if (typeof(cd) === 'string') {
					if (allowed_types & filetypes.FILE) {
						return resolve(new ReadFile(cd));
					} else {
						return reject(fserrors.IS_FILE);
					}
				}
				if (typeof(cd) === 'object') {
					if (allowed_types & filetypes.DIRECTORY) {
						return resolve(cd);
					} else {
						return reject(fserrors.IS_DIRECTORY);
					}
				}

			});
		}
	}

	const rootfs = new LSFilesystem('FS');

	/* Get a ReadFile from a path.
	 *
	 * @argument path : string : The path to read the file from.
	 *
	 * @returns Promise : A promise that will resolve to a ReadFile or reject to a fserror.
	 */
	function getFile(path) {
		return rootfs.getFile(path, filetypes.FILE);
	}

	let processes = [];
	
	/* The enum of states a Process can be in
	 *
	 * NOT_STARTED: The process has not yet started, probably because it is still loading its code.
	 * RUNNING: The process is currently runnung.
	 * FINISHED: The process has finished its execution and is waiting to be collected.
	 */
	const states = Object.freeze({
		NOT_STARTED: 1,
		RUNNING: 2,
		FINISHED: 3
	});

	/* The enum of process actions (syscalls)
	 *
	 * TERMINATE: Terminate the process.
	 * READFROMFD: Read data from file decriptor.
	 * WRITETOFD: Write data to file descriptor.
	 * LISTENONFD: Listens on a file descriptor and fires an interrupt whenever data is available.
	 * CLOSEFD: Closes a file descriptor.
	 * SPAWNSUBPROCESS: Spawns a subprocess.
	 * GETPROCESSSTATE: Gets the state of a process.
	 * DRAW: Draws to the screen.
	 * LOGDATA: Output data to the JavaScript console. NOT STANDARDIZED!
	 */
	const processactions = Object.freeze({
		TERMINATE: 1,
		READFROMFD: 2,
		WRITETOFD: 3,
		LISTENONFD: 4,
		CLOSEFD: 5,
		SPAWNSUBPROCESS: 8,
		GETPROCESSSTATE: 9,
		DRAW: 32,
		LOGDATA: 255
	});

	/* A user process running on the OS.
	 *
	 * @argument args : string[] : The arguments to pass to the process.
	 */
	class Process {
		constructor(args) {
			let This = this;
			this.pid = 0|(65536 * Math.random());
			this.argv = args;
			this.argc = args.length;
			this.state = states.NOT_STARTED;
			this.stdin = new Pipe();
			this.stdout = new Pipe();
			this.stderr = new Pipe();
			this.openfds = [this.stdin, this.stdout, this.stderr];

			getFile(args[0]).then( file => {
				This.code = prelude + file.content;
				This.run();
			}).catch( error => {
				// TODO: Handle error.
				This.state = states.FINISHED;
				console.log(error);
			});
		}

		run() {
			let This = this;
			let uri = dataURI(this.code, 'text/javascript');
			this.state = states.RUNNING;
			this.worker = new Worker(uri);
			this.worker.onmessage = message => {
				This.handleMessage(message.data);
			};
			this.worker.postMessage({
				type: 'action',
				action: 'run',
				args: this.argv,
				pid: this.pid
			});
		}

		handleMessage(message) {
			if (typeof(message) !== 'object' || !('action' in message)) {
				return;
			}

			switch (message.action) {
				case processactions.LOGDATA:
					{
						console.log(`Process ${ this.pid } says ${ message.data }`);
					}
					break;
				case processactions.TERMINATE:
					{
						this.worker.terminate();
						this.state = states.FINISHED;
					}
					break;
				case processactions.WRITETOFD:
					{
						let fdo = this.openfds[message.fd];
						if (fdo && fdo.constructor === Pipe) {
							fdo.write(message.data);
						}
					}
					break;
				case processactions.LISTENONFD:
					{
						let fdo = this.openfds[message.fd];
						if (fdo && fdo.constructor === Pipe) {
							let This = this;
							fdo.ondata = () => {
								This.worker.postMessage({
									type: 'interrupt',
									sig: message.sig,
									data: fdo.read(-1)
								});
							};
						}
					}
					break;
				case processactions.CLOSEFD:
					{
						this.openfds[message.fd] = null;
					}
					break;
				case processactions.SPAWNSUBPROCESS:
					{
						let proc = new Process(message.args);
						processes.push(proc);
						this.openfds.push(proc.stdin);
						this.openfds.push(proc.stdout);
						this.openfds.push(proc.stderr);
						if ('response_code' in message) {
							this.worker.postMessage({
								type: 'response',
								code: message.response_code,
								pid: proc.pid,
								stdin: this.openfds.length - 3,
								stdout: this.openfds.length - 2,
								stderr: this.openfds.length - 1
							});
						}
					}
					break;
				case processactions.GETPROCESSSTATE:
					{
						let proc = processes.filter(p => p.pid === message.pid)[0];
						this.worker.postMessage({
							type: 'response',
							code: message.response_code,
							state: proc ? proc.state : states.FINISHED
						});
					}
					break;
				case processactions.DRAW:
					switch (message.form) {
						case 'text-display':
							ctx.fillStyle = '#000';
							ctx.rect(0,0,960,384);
							ctx.fill();
							ctx.font = '15px monospace';
							ctx.textAlign = 'left';
							ctx.fillStyle = '#bbb';
							for (let i = 0; i < 24*80; i++) {
								let ln = 0|(i / 80);
								let col = i % 80;
								let x = col * 12;
								let y = ln * 16 + 15;
								ctx.fillText(message.data[i], x, y);
							}
							break;
					}
					break;
			}
		}
	}
	
	
	// Boots the OS.
	function boot() {
		processes.push( new Process([ '/boot/init' ]) );
		document.addEventListener('keypress', evt => {
			processes[0].worker.postMessage({
				type: 'interrupt',
				sig: 1,
				key: evt.key
			});
		});
		setInterval( () => {
			for (let i = processes.length - 1; i >= 0; i--) {
				if (processes[i].state === states.FINISHED) {
					processes.splice(i, 1);
				}
			}
		}, 4096);
	}

	boot();

	self.processes = processes;
};
