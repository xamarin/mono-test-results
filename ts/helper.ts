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

// Config -- Put debug options (put #! after URL) in options dict

let options = {}

function hashchange() {
	options = {}
	let hash = location.hash
	if (startsWith(hash, "#!")) {
		hash = hash.substring(2)
		hash.split('&').forEach(function(x) {
			let [key, value] = splitOne(x, '=')
			options[key] = value
		})
	}
}

$(window).on('hashchange', hashchange)
hashchange()
