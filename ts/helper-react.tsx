/// <reference path="helper.ts" />
// Generic utility classes and functions-- React-dependent materials only

// Components: General display helpers

// Image with the "icon" CSS class
class IconProps {
	src: string
}

class Icon extends React.Component<IconProps, {}> {
	render () {
		return <img className="icon" src={this.props.src} />
	}
}

// <a href> hardcoded to pop out in new frame
class AProps {
	href: string
	title: string
}

class A extends React.Component<AProps,{}> {
	render() {
		return <a href={this.props.href} title={this.props.title} target='_blank' >
			{(this.props as any).children}
		</a>
	}
}

// Link with a mouse handler callback
class ClickableProps {
	handler: React.EventHandler<React.MouseEvent<any>>
	key: string
	label: string
}

class Clickable extends React.Component<ClickableProps, {}> {
	render() {
		return <a key={this.props.key}
					href="javascript:void(0)"
					className="clickable"
					onClick={this.props.handler}
				>{this.props.label}</a>
	}
}

// Same as Clickable, but visible contents are child nodes instead of a property
class ClickableSpanProps {
	handler: React.EventHandler<React.MouseEvent<any>>
	key: string
}

class ClickableSpan extends React.Component<ClickableSpanProps, {}> {
	render() {
		return <a key={this.props.key}
					href="javascript:void(0)"
					className="clickable"
					onClick={this.props.handler}
				>{(this.props as any).children}</a>
	}
}

// Get and set #hash in URL. In react-tsx because some of this calls invalidateUi

let hashOptions : StringDict = emptyObject()
let hashRefs : { [key:string]:HashRef<any> } = emptyObject()

function dictToHash(dict: StringDict) {
	let keys = Object.keys(dict).sort()
	return '#' +
		keys.map( key =>
			encodeURIComponent(key) + "=" + encodeURIComponent(dict[key])
		).join("&")
}

function hashToDict(hash:string) : StringDict {
	let options : StringDict = emptyObject()
	if (startsWith(hash, "#")) {
		hash = hash.substring(1)
		hash.split('&').forEach(function(x) {
			let [key, value] = splitOne(x, '=')
			options[decodeURIComponent(key)] = (value == null ? "true" : decodeURIComponent(value))
		})
	}
	return options
}

// Can be used with functions that understand Ref<T>, but loads its default value
// from the URL hash and likewise stores any set() value back to the URL hash.
class HashRef<T> extends Ref<T> {
	hashKey:string
	enum: any
	active: boolean // Has been set away from default
	defaultValue: T // For resetting
	constructor(hashKey:string, _enum:any, defaultValue:T) {
		let overloaded = hashHas(hashKey)
		super(overloaded ? enumFilter(hashValue(hashKey), _enum) : defaultValue)
		this.hashKey = hashKey
		this.enum = _enum
		this.defaultValue = defaultValue
		hashRefs[hashKey] = this
	}

	set(value: T) {
		this.value = value
		this.active = (this.value != null)
		triggerHashPush()
		invalidateUi()
	}

	stringValue() {
		if (this.enum)
			return this.enum[this.value as any]
		return ""+this.value
	}
}

function hashHas(key:string) {
	return key in hashOptions
}

function hashValue(key:string) {
	return hashOptions[key]
}

let needHashPush:boolean = false

// One or more HashRef objects has changed, and the URL hash must be updated.
// Lazily do this as an asynchronous callback so HashRef updates will batch together.
function tryHashPush() {
	if (!needHashPush)
		return
	let newHashOptions = emptyObject()
	for (let key in hashRefs) {
		let ref = hashRefs[key]
		if (ref.active)
			newHashOptions[key] = ref.stringValue()
	}
	if (objectEqual(hashOptions, newHashOptions)) // Is this automatic?
		return
	hashOptions = newHashOptions
	history.pushState(null, null, dictToHash(hashOptions))
}

function triggerHashPush() {
	needHashPush = true
	setTimeout(tryHashPush, 0)
}

// The URL hash has changed, and the changes need to be copied back into the HashRef objects.
function hashchange() {
	hashOptions = hashToDict( location.hash ? location.hash : '' )

	// Run through existing refs and clear anything that's been unset
	for (let key of Object.keys(hashRefs)) {
		if (!(key in hashOptions)) {
			let ref = hashRefs[key]
			ref.active = false
			ref.value = ref.defaultValue
		}
	}
	// Run through hash options and set corresponding refs
	for (let key of Object.keys(hashOptions)) {
		let ref = hashRefs[key]
		if (ref) {
			ref.value = enumFilter(hashOptions[key], ref.enum)
			ref.active = true
		}
	}
	invalidateUi()
}

$(window).on('hashchange', hashchange)
hashchange()

// Components: "UI elements"

/* FIXME: I'm not sure why "value" has to be passed in explicitly; it ought to
 * be derivable from data, but when I tried that I didn't get rerenders. Maybe
 * I am not using React correctly here. --Andi */
class ChoiceProps<Key> {
	name: string
	enum: any
	data: Ref<Key>
	value: Key     // Pass in the current value of data.value when making props object
}

// A "radio button" style selector where the options are an Enum.
// Current selected value is stored in a Ref<T>.
class Choice<Key> extends React.Component<ChoiceProps<Key>, {}> {
	constructor(props: ChoiceProps<Key>) {
		super(props)
	}

	render() {
		let currentLabel: string;
		let children: JSX.Element[] = []
		for (let key of enumStringKeys(this.props.enum)) {
			let value = this.props.enum[key] as Key

			let reactKey = "button"+value

			// Insert spaces into enum key name. I admit that this is a little silly.
			let label = key[0]
			for (let i = 1; i < key.length; i++) {
				let ch = key[i]
				// Split immediately before: the first number in any series, or any single capital letter
				if ((isUpperCaseChar(ch) && !isUpperCaseChar(key[i-1]) &&
						!(i+1 < key.length && isUpperCaseChar(key[i+1])))
					|| (isNumberChar(ch) && !isNumberChar(key[i-1]))) {
					label += " "
					label += ch.toLowerCase()
				} else {
					label += ch
				}
			}

			if (value == this.props.value)
				currentLabel = label;

			children.push(
				<li>
					<Clickable key={reactKey} label={label}
						handler={
							e => {
								this.props.data.set( value )
								invalidateUi()
							}
						} />
				</li>
			)
		}

		return	<div className="btn-group" role="group">
					<button type="button" className="btn btn-default dropdown-toggle" data-toggle="dropdown">
						{this.props.name}: <b>{currentLabel}</b>
						&nbsp;<span className="caret"></span>
					</button>
					<ul className="dropdown-menu">
						{children}
					</ul>
				</div>
	}
}

class CheckboxProps<Key> {
	enum: any
	data: Ref<Key>
	value: Key     // Pass in the current value of data.value when making props object
	on: Key
	off: Key
	label:string
}

// A checkbox which draws its values from an enum and stores its result in a Ref<T>.
class Checkbox<Key> extends React.Component<CheckboxProps<Key>, {}> {
	constructor(props) {
		super(props)
	}

	render() {
		let currentlyChecked:boolean = this.props.data.value == this.props.on
		return (
			<div className="checkbox">
				<label>
					<input
						type="checkbox"
						checked={currentlyChecked}
						onChange={
							e => {
								this.props.data.set( currentlyChecked ? this.props.off : this.props.on )
								invalidateUi()
							}
						}
					/> {" "}
					{this.props.label}
				</label>
			</div>
		)
	}
}


// Date utils

const dayMs = 24*60*60*1000

function formatDate(date: Date) {
	let day = null
	let now = new Date()
	if (sameDay(now, date)) {
		day = "Today"
	} else {
		let yesterday = new Date(+now - dayMs)
		if (sameDay(yesterday, date))
			day = "Yesterday"
	}

	if (day)
		return <span className="datetime">{day} {date.toLocaleTimeString()}</span>
	else
		return <span className="datetime">{date.toLocaleString()}</span>
}

function formatRange(range: DateRange) {
	if (!range.early || !range.late)
		return <i>(Invalid date)</i>
	return <span className="datetimeRange">{formatDate(range.early)} - {formatDate(range.late)}</span>
}

function formatRangeLaterWithLabel(range: DateRange, label:string) {
	return <span className="datetime">
		{label}: {
			range.late
				? formatDate(range.late)
				: <span>never</span>
		}
	</span>
}

// Components: Top title bar
// The set of html files in static/ is known and hardcoded here

let titleBarSpec = [
	["index.html", "Quick status"],
	["builds.html", "Build logs"],
	["builds-plus.html", "Build logs (Special configurations)"],
	["builds-stress.html", "Stress test"],
	["builds-profiler.html", "Profiler stress tests"],
	["builds-2017-10.html", "2017-10"],
	// ["https://jenkins.mono-project.com/view/All/job/jenkins-testresult-viewer/", "Source"]
]

// Figure out current page from URL. Show current page to left, links to all other pages to right
class TitleBar extends React.Component<{}, {}> {
	render() {
		let currentPath = window.location.pathname
		let currentFilename = currentPath.substring(currentPath.lastIndexOf('/')+1)
		let pages : JSX.Element[] = []
		for (let spec of titleBarSpec) {
			let url = spec[0]
			let title = spec[1]
			if (currentFilename == url) {
				pages.push(<li className="active"><a href={url} key={url}>{title}</a></li>)
			} else {
				pages.push(<li><a href={url} key={url}>{title}</a></li>)
			}
		}
		return	<nav className="navbar navbar-inverse">
					<div className="container-fluid">
						<div className="navbar-header">
							<div className="navbar-brand">
								<img alt="Mono Logo" src="images/mono-gorilla.png" height="25px" />
							</div>
						</div>
						<div className="navbar-header">
							<ul className="nav navbar-nav">
								{pages}
							</ul>
						</div>
					</div>
				</nav>
	}
}


// Components: Loading/reload controls for a set of lanes

let loadingIcon = <span><Icon src="images/loading.gif" /> Loading...</span>

let reloadControlEverLoaded = false

function makeReloadControl<T extends BuildBase>(lanes: Lane<T>[], currentlyLoading: () => boolean) {
	let ReloadControl = React.createClass({
		render: function() {
			let loading = currentlyLoading()

			if (!reloadControlEverLoaded) { // Don't display before first load completes
				if (loading)
					return null
				reloadControlEverLoaded = true
			}

			let reloadControl = <span><Icon src="images/reload.png" /> Reload</span>

			if (!currentlyLoading())
				reloadControl = <ClickableSpan key={null} handler={
					e => {
						for (let lane of lanes) {
							lane.status = new Status()
							lane.load()
						}
						invalidateUi()
					}
				}>{reloadControl}</ClickableSpan>

			return <div className="reloadControl">{reloadControl}</div>
		}
	})
	return ReloadControl
}

// Display refresh. To use, call registerRender(callback) at the start of the
// application, and invalidateUi whenever data relevant to display changes.

let needRender = false
let renderCallback: ()=>void = null
function registerRender(callback: ()=>void) {
	renderCallback = callback
}
function render() {
	if (renderCallback)
		renderCallback()
	needRender = false
}
function tryRender() {
	if (needRender)
		render()
}
function invalidateUi() {
	needRender = true
	setTimeout(tryRender, 0)
}
