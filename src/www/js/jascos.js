'use strict'

function Jascos (screen) {
	
	const ctx = screen.getContext('2d');

	const prelude = ``;

	const INITJS = `
		var screen = Array(24).fill(null).map( _ => Array(80).fill(' ') );
		
		var cursor = {ln: 0, col: 0};

		function updateScreen() {
			let data = screen.map( line => line.join('') ).join('');
			postMessage({
				action: 32,
				form: 'text-display',
				data: data
			});
		}

		function scrollUp() {
			for (let ln = 0; ln < 23; ln++) {
				for (let col = 0; col < 80; col++) {
					screen[ln][col] = screen[1+ln][col];
				}
			}
			screen[23].fill(' ');
		}

		function writeChar(c) {
			if (c.length !== 1) throw TypeError('Expected char');

			screen[cursor.ln][cursor.col] = c;
			if (80 === ++cursor.col) {
				cursor.col = 0;
				if (24 === ++cursor.ln) {
					cursor.ln = 23;
					scrollUp();
				}
			}
		}

		function writeString(s) {
			for (let c of s) {
				writeChar(c);
			}
		}

		setTimeout( () => {
			writeString('Hello, world!');
			updateScreen();
		}, 1000);

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

	// TODO: Implement filesystem.

	/* An object representing a file that has been read.
	 *
	 * @argument content : string : The content of the file.
	 */
	class ReadFile {
		constructor(content) {
			this.content = content;
		}
	}
	
	/* The enum of filesystem errors
	 *
	 * NOT_FOUND: The file doesn't exist.
	 * PERMISSION_DENIED: You do not have permission to do that.
	 * INVALID_OPERATION: The file doesn't support the attempted operation.
	 */
	const fserrors = Object.freeze({
		NOT_FOUND: 1,
		PERMISSION_DENIED: 2,
		INVALID_OPERATION: 3
	});

	/* Get a ReadFile from a path/
	 *
	 * @argument path : string : The path to read the file from.
	 *
	 * @returns Promise : A promise that will resolve to a ReadFile or reject to a fserror.
	 */
	function getFile(path) {
		if (path === '/init.js') {
			return new Promise( (resolve, reject) => {
				let file = new ReadFile(INITJS);
				resolve(file);
			});
		}

		return new Promise( (resolve, reject) => {
			reject(fserrors.NOT_FOUND);
		});
	}

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
	 * DRAW: Draws to the screen.
	 * LOGDATA: Output data to the JavaScript console. NOT STANDARDIZED!
	 */
	const processactions = Object.freeze({
		TERMINATE: 1,
		READFROMFD: 2,
		WRITETOFD: 3,
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

			getFile(args[0]).then( file => {
				This.code = prelude + file.content;
				This.run();
			}).catch( error => {
				// TODO: Handle error.
				This.state = states.FINISHED;
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
		}

		handleMessage(message) {
			if (typeof(message) !== 'object' || !('action' in message)) {
				return;
			}

			switch (message.action) {
				case processactions.LOGDATA:
					console.log(`Process ${ this.pid } says ${ message.data }`);
					break;
				case processactions.WRITETOFD:
					let fd = message.fd;
					if (fd === 1) {
						this.stdout.write(message.data);
					} else if (fd === 2) {
						this.stderr.write(message.data);
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
	
	let processes = [];
	
	// Boots the OS.
	function boot() {
		processes.push( new Process([ '/init.js' ]) );
	}

	boot();
};
