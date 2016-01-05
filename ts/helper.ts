/// <reference path="../typings/tsd.d.ts" />

// String ops

function startsWith(str:string, search:string) {
	return str.substring(0,search.length) == search
}

function splitOne(str:string, demarcate:string) {
	let index = str.indexOf(demarcate)
	if (index < 0)
		return [str, null]
	return [ str.substring(0,index), str.substring(index) ]
}

// Config

let options = {}

function hashchange() {
	options = {}
	let hash = location.hash
	if (startsWith(hash, "!")) {
		hash = hash.substring(1)
		hash.split('&').forEach(function(x) {
			let args = splitOne(x, '=')
			options[args[0]] = args[1]
		})

	}
}

$(window).on('hashchange', hashchange)
hashchange()
