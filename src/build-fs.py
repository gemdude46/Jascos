#!/usr/bin/env python3

import json
from os import listdir, chdir
from os.path import join as pjoin, isdir, isfile

chdir('/home/gemdude46/Jascos/src')

def cat_file(path):
	f = open(path, 'r')
	c = f.read()
	f.close()

	return c

def gen_dir(path):
	diro = {}
	for f in listdir(path):
		apath = pjoin(path, f)
		if isfile(apath):
			diro['$'+f] = cat_file(apath)
		if isdir(apath):
			diro['$'+f] = gen_dir(apath)
	
	return diro

if '__main__' == __name__:
	f = open('www/data/default-filesystem.json', 'w')
	json.dump(gen_dir('fs'), f)
	f.close()
