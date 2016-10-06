/// <reference path="helper.ts" />

class IconProps {
	src: string
}

class Icon extends React.Component<IconProps, {}> {
	render () {
		return <img className="icon" src={this.props.src} />
	}
}

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

class ClickableProps {
	handler: React.EventHandler<React.MouseEvent>
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

class ClickableSpanProps {
	handler: React.EventHandler<React.MouseEvent>
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

function enumFilter(value:any, _enum:any) {
	return (_enum ? _enum[value] : value)
}

// Use to pass an argument into a function "by reference"
class HashRef<T> extends Ref<T> {
	hashKey:string
	enum: any
	active: boolean // Has been set away from default
	constructor(hashKey:string, _enum:any, defaultValue:T) {
		let overloaded = hashHas(hashKey)
		super(overloaded ? enumFilter(hashValue(hashKey), _enum) : defaultValue)
		this.hashKey = hashKey
		this.enum = _enum
		this.active = overloaded
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

function hashchange() {
	hashOptions = hashToDict( location.hash ? location.hash : '' )
	for (let key of Object.keys(hashRefs)) {
		let ref = hashRefs[key]
		ref.active = false
	}
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

/* FIXME: I'm not sure why "value" had to be passed in explicitly; it ought to
 * be derivable from data, but when I tried that I didn't get rerenders. Maybe
 * I am not using React correctly here. --Andi */
class ChoiceProps<Key> {
	enum: any
	data: Ref<Key>
	value: Key
}

class Choice<Key> extends React.Component<ChoiceProps<Key>, {}> {
	constructor(props: ChoiceProps<Key>) {
		super(props)
	}

	render() {
		let children: JSX.Element[] = []
		let first = true
		for (let key of enumStringKeys(this.props.enum)) {
			let value = this.props.enum[key] as Key

			if (!first)
				children.push(<span key={"comma"+value}>, </span>)

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

			if (value == this.props.value) {
				children.push(<span key={reactKey}>{label}</span>)
			} else {
				children.push(<Clickable key={reactKey} label={label}
					handler={
						e => {
							this.props.data.set( value )
							invalidateUi()
						}
					} />)
			}
			first = false
		}
		return <span className="choice">{children}</span>
	}
}

class CheckboxProps<Key> extends ChoiceProps<Key> {
	on: Key
	off: Key
	label:string
}

class Checkbox<Key> extends React.Component<CheckboxProps<Key>, {}> {
	constructor(props) {
		super(props)
	}

	render() {
		let currentlyChecked:boolean = this.props.data.value == this.props.on
		return (
			<span className="checkbox">
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
			</span>
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

// Components: Top title bar

let titleBarSpec = [
	["index.html", "Quick status"],
	["failures.html", "Failure logs"],
	["failures-plus.html", "Failure logs (special configurations)"],
	["failures-4.8.html", "Failure logs (4.8 branch)"],
	// ["https://jenkins.mono-project.com/view/All/job/jenkins-testresult-viewer/", "Source"]
]

// Figure out current page from URL. Show current page to left, links to all other pages to right
class TitleBar extends React.Component<{}, {}> {
	render() {
		let pageTitle = "CI viewer" // Title for unknown page
		let currentPath = window.location.pathname
		let currentFilename = currentPath.substring(currentPath.lastIndexOf('/')+1)
		let otherPages : JSX.Element[] = []
		for (let spec of titleBarSpec) {
			let url = spec[0]
			let title = spec[1]
			if (currentFilename == url) {
				pageTitle = title
			} else {
				if (otherPages.length)
					otherPages.push(<span> | </span>)
				otherPages.push(<a href={url}>{title}</a>)
			}
		}
		return <div>
				<span className="pageTitle">{pageTitle}</span> {" "}
				| See also: {otherPages}
			</div>
	}
}


// Components: 

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

// Display refresh

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
