/// <reference path="../typings/tsd.d.ts" />

// String ops

function startsWith(str:string, search:string) {
	return str.substring(0,search.length) == search
}

function splitOne(str:string, demarcate:string) {
	let index = str.indexOf(demarcate)
	if (index < 0)
		return [str, null]
	return [ str.substring(0,index), str.substring(index+1) ]
}

function isUpperCaseChar(str:string) {
	return str.toUpperCase() == str && str.toLowerCase() != str
}

let numTest = /\d/
function isNumberChar(str:string) {
	return numTest.test(str)
}

let letterTest = /\w/
function lettersOnly(str:string) {
	return str.replace(letterTest, '')
}

// Assume NaNs and infinities indicate an error somewhere
function toNumber(str: string) {
	let n = +str
	if (!isFinite(n))
		throw new Error("Converted non-numeric string to number: " + str)
	return n
}

// Typescript ops

function enumStringKeys(e) {
	return Object.keys(e).filter(key => typeof e[key] === "number")
}

// Use to pass an argument into a function "by reference"
// Use set() to change value because subclasses trigger effects on change
class Ref<T> {
	constructor(public value: T) {}
	set(value: T) { this.value = value }
	clear() { this.set(null) }
}

// Dictionary helpers

function getOrDefault<V>(dict: {[key:string]:V}, key:string, build: () => V) {
	let result = dict[key]
	if (!result) {
		result = build()
		dict[key] = result
	}
	return result
}

// Duplicate because of weird edge case in Typescript type rules
function getIdxOrDefault<V>(dict: {[idx:number]:V}, key:number, build: () => V) {
	let result = dict[key]
	if (!result) {
		result = build()
		dict[key] = result
	}
	return result
}

function countKeys(dict: any) {
	let result = 0
	for (let _ of Object.keys(dict))
		result++
	return result
}

function numericSort(a:string, b:string) : number {
	return (+a) - (+b)
}

// I guess there's an Object.values in ES7 or something??
function objectValues<T>(dict: { [key: string] : T}) : T[] {
	return Object.keys(dict).map(key => dict[key])
}

function objectSize(obj) {
	return Object.keys(obj).length
}

// Dictionary with no default properties
function emptyObject() { return Object.create(null) }

function objectEqual<T>(x:T, y:T) {
	if (objectSize(x) != objectSize(y))
		return false
	for (let key of Object.keys(x)) {
		let vx = x[key]
		let vy = y[key]
		if (vx != vy)
			return false
	}
	return true;
}

// Date ops

function sameDay(a:Date, b:Date) {
	return a.getFullYear() == b.getFullYear() && a.getMonth() == b.getMonth() && a.getDate() == b.getDate()
}

class DateRange {
	early:Date
	late:Date

	add(date: Date) {
		if (!date)
			return
		if (!this.early || date < this.early)
			this.early = date
		if (!this.late || date > this.late)
			this.late = date
	}
}

function dateRangeLaterCmpFor(buildListings) {
	function dateRangeLaterCmp(a:string,b:string) { // Sort by date
		let ad = buildListings[a].dateRange.late
		let bd = buildListings[b].dateRange.late
		return ((+bd) - (+ad))
	}
	return dateRangeLaterCmp
}

class Listing {
	dateRange: DateRange

	constructor() {
		this.dateRange = new DateRange()
	}
}

// Local storage wrappers: enforce key prefix, keep track of data-in-use

const localStoragePrefix = "testresults!"

function localStorageUsageDelta(delta:number) {
	let usageKey = localStoragePrefix + "usage"
	let usage = toNumber(localStorage.getItem(usageKey))
	usage += delta
	localStorage.setItem(usageKey, String(usage))
}

function localStorageSetItem(key:string, value:string) {
	let fullKey = localStoragePrefix + key
	let previous = localStorage.getItem(fullKey)

	localStorage.setItem(fullKey, value)

	localStorageUsageDelta(value.length +
		(previous == null ? fullKey.length : -previous.length))
}

function localStorageGetItem(key:string) {
	return localStorage.getItem(localStoragePrefix + key)
}

function localStorageUsage() {
	let usageKey = localStoragePrefix + "usage"
	let usage = localStorage.getItem(usageKey)
	return toNumber(usage) + (usage != null ? usageKey.length + usage.length : 0)
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

// Delete a single item from local storage
function localStorageClearOne(key:string) {
	let fullKey = localStoragePrefix + key
	let previous = localStorage.getItem(fullKey)
	if (previous != null)
		localStorageUsageDelta(-key.length - previous.length)
	localStorage.removeItem(fullKey)
}