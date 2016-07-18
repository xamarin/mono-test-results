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

// Typescript ops

function enumStringKeys(e) {
	return Object.keys(e).filter(key => typeof e[key] === "number")
}

class Ref<T> {
	value: T
	constructor(value: T) { this.value = value }
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

// Local storage wrappers: enforce key prefix, keep track of data-in-use

const localStoragePrefix = "testresults!"

function localStorageUsageDelta(delta:number) {
	let usageKey = localStoragePrefix + "usage"
	let usage = +localStorage.getItem(usageKey)
	usage += delta
	localStorage.setItem(usageKey, String(usage))
}

function localStorageSetItem(key:string, value:string) {
	let fullKey = localStoragePrefix + key
	let previous = localStorage.getItem(fullKey)

	localStorage.setItem(fullKey, value)

	localStorageUsageDelta(value.length +
		(previous == null ? key.length : -previous.length))
}

function localStorageGetItem(key:string) {
	return localStorage.getItem(localStoragePrefix + key)
}

function localStorageUsage() {
	let usageKey = localStoragePrefix + "usage"
	let usage = localStorage.getItem(usageKey)
	return +usage + (usage != null ? usageKey.length + usage.length : 0)
}

function jsonLines(str:String) : any[] {
	return str.split("\n").filter(line =>
		/\S/.test(line)
	).map(line =>
		JSON.parse(line)
	)
}

// Delete anything from local storage whose key begins with our prefix plus an additional prefix
function localStorageClear(prefix:string = "") {
	let fullPrefix = localStoragePrefix + prefix
	let doomed = []
	for (let i = 0; i < localStorage.length; i++) {
    	let key = localStorage.key(i)
    	if (startsWith(key, fullPrefix))
    		doomed.push(key)
	}
	for (let key of doomed) {
		if (prefix) { // When deleting everything, don't bother adjusting usage
			let previous = localStorage.getItem(key)
			if (previous != null)
				localStorageUsageDelta(-key.length - previous.length)
		}
		localStorage.removeItem(key)
	}
}
