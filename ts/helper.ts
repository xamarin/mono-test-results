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

// Local storage wrappers (keep track of data-in-use)

function localStorageSetItem(key:string, value:string) {
	localStorage.setItem("testresults!" + key, value)

	let usageString:string = localStorage.getItem("testresults!usage")
	let usage = usageString ? +usageString : 0
	usage += value.length
	localStorage.setItem("testresults!usage", String(usage))
}

function localStorageGetItem(key:string) {
	return localStorage.getItem("testresults!" + key)
}

function localStorageUsage() {
	let usageString:string = localStorageGetItem("usage")
	return +usageString + usageString.length
}

function jsonLines(str:String) : any[] {
	return str.split("\n").filter(line =>
		/\S/.test(line)
	).map(line =>
		JSON.parse(line)
	)
}
