/// <reference path="./test-download.ts" />
/// <reference path="./helper-react.tsx" />

// Constants

const max_failures_unexpanded = 5
const dayMs = 24*60*60*1000

// Load

enum FailureKind {
    Unknown,
    Test,
    Crash,
    Hang
}

function failureDescribe(kind: FailureKind) {
	switch (kind) {
		case FailureKind.Test:
			return "Testcase failure"
		case FailureKind.Crash:
			return "Crash"
		case FailureKind.Hang:
			return "Hang"
		default:
			return "Unknown failure"
	}
}

class Failure {
	step: string
	test: string
	kind: FailureKind

	constructor(step:string, test:string = null) {
		this.step = step
		this.test = test
		this.kind = FailureKind.Unknown
	}

	key() : string {
		return this.step + (this.test ? this.test : "")
	}
}

class Build extends BuildBase {
	date: Date
	result: string
	failures: Failure[]
	pr: string
	prUrl: string
	prTitle: string

	constructor(laneTag: string, id: string) {
		super(laneTag, id)
		this.failures = []
	}

	interpretMetadata(json) {
		if ('debug' in options) console.log("Got metadata", json)

		this.date = new Date(+json.timestamp)
		this.result = json.result

		if (json.actions && json.actions.length && json.actions[0].parameters) {
			for (let param of json.actions[0].parameters) {
				switch (param.name) {
					case "ghprbPullId":
						this.pr = param.value
						break
					case "ghprbPullLink":
						this.prUrl = param.value
						break
					case "ghprbPullTitle":
						this.prTitle = param.value
						break
					default: break
				}
			}
		}
	}

	// See scripts/ci/babysitter in mono repo for json format
	interpretBabysitter(jsons: any[]) {
		if ('debug' in options) console.log("Got babysitter", jsons)

		for (let json of jsons) {
			if (json.final_code) {
				let resolved = false
				if (json.babysitter_protocol) {
					for(let testName in json.tests) {
						let failure = new Failure(json.invocation, testName)
						let test = json.tests[testName]
						if (test.crash_failures)
							failure.kind = FailureKind.Crash
						else if (test.timeout_failures)
							failure.kind = FailureKind.Hang
						else if (test.normal_failures)
							failure.kind = FailureKind.Test

						this.failures.push(failure)
						resolved = true
					}
				}
				if (!resolved) {
					let failure = new Failure(json.invocation)
					this.failures.push(failure)
				}
			}
		}
	}

	resultString() {
		return this.result ? this.result : "(In progress)"
	}
}

let lanes = makeLanes(Build)

// Display state

enum GroupBy {
	Lanes,
	Builds,
	Failures,
}

enum Visibility {
	Show,
	Hide
}

enum DisplaySpan {
	AllCached,
	Last7Days,
	Last48Hr,
	Last24Hr
}

class ChoiceVisibility extends Choice<Visibility> {}
let prVisible = new Ref(Visibility.Hide)
let inProgressVisible = new Ref(Visibility.Hide)

class ChoiceGroupBy extends Choice<GroupBy> {}
let groupBy = new Ref(GroupBy.Lanes)

class ChoiceDisplaySpan extends Choice<DisplaySpan> {}
let displaySpan = new Ref(DisplaySpan.Last48Hr)

// Utility

function filterLanes() {
	return lanes.filter( lane =>
		(prVisible.value == Visibility.Show || !lane.isPr)
	)
}

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

function formatRange(range: DateRange) {
	if (!range.early || !range.late)
		return <i>(Invalid date)</i>
	return <span className="datetimeRange">{formatDate(range.early)} - {formatDate(range.late)}</span>
}

function buildInTimespan(build: Build) {
	let cutoff: number // In days
	switch (displaySpan.value) {
		case DisplaySpan.AllCached:
			return true
		case DisplaySpan.Last24Hr:
			cutoff = 1
			break
		case DisplaySpan.Last48Hr:
			cutoff = 2
			break
		case DisplaySpan.Last7Days:
			cutoff = 7
			break
	}
	let now = new Date()
	return +build.date > (+now - cutoff*dayMs)
}

function currentlyLoading() {
	for (let lane of filterLanes())
		if (!lane.status.loaded || lane.buildsRemaining > 0)
			return true
	return false
}

// Listing containers

class Listing {
	dateRange: DateRange

	constructor() {
		this.dateRange = new DateRange()
	}
}

class BuildListing extends Listing {
	failedLanes: number
	inProgressLanes: number
	lanes: { [laneIndex:number]: Build }

	constructor() {
		super()
		this.inProgressLanes = 0
		this.failedLanes = 0
		this.lanes = {}
	}
}

class FailureListing extends Listing {
	count: number
	builds: { [id:string]: boolean }
	lanes: { [laneIndex:number]: boolean }
	obj: Failure

	constructor(obj: Failure) {
		super()
		this.obj = obj
		this.count = 0
		this.builds = {}
		this.lanes = {}
	}
}

// Presentation

let loadingIcon = <span><Icon src="images/loading.gif" /> Loading...</span>

let LoadingBox = React.createClass({
	render: function() {
		if (currentlyLoading())
			return <div className="loadingBox"><p>{loadingIcon}</p></div>
		else
			return <div>&nbsp;</div>
	}
})

let ReloadControl = React.createClass({
	render: function() {
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

let LaneErrorBox = React.createClass({
	render: function() {
		let errors = filterLanes().filter(lane => lane.status.failed)
		if (errors.length) {
			let errorDisplay = errors.map(lane =>
				<div className="errorItem">
					<Icon src="images/error.png" />
					Failed to load index for lane <strong>{lane.name}</strong>
				</div>
			)
			return <div className="errorBox">{errorDisplay}</div>
		} else {
			return null
		}
	}
})

function renderFailure(failure: Failure) {
	let testLine = failure.test ? <div className="failedTestName">{failure.test}</div> : null
	let key = failure.step + "!" + failure.test
	return <li key={key} className="failure">
		<div>
			{failureDescribe(failure.kind)} while running <span className="invocation">{failure.step}</span>
		</div>
		{testLine}
	</li>
}

class BuildFailuresProps {
	build: Build
	key: string
	linkLabel: string
	extraLabel: JSX.Element
}

class BuildFailuresState {
	expand:boolean
}

class BuildFailures extends React.Component<BuildFailuresProps, BuildFailuresState> {
	constructor(props: BuildFailuresProps) {
		super(props)
		this.state = {expand: false}
	}
	render() {
		let build = this.props.build
		let key = this.props.key
		let buildLink = <span><A href={build.displayUrl} title={null}>{this.props.linkLabel}</A> {this.props.extraLabel}</span>

		if (!build.metadataStatus.failed) {
			let failures: JSX.Element[]
			let failureDisplay : JSX.Element = null

			if (!this.state.expand && build.failures.length > max_failures_unexpanded) {
				let showCount = max_failures_unexpanded - 1 // Never show "1 more failures"
				let failureSlice = build.failures.slice(0, showCount)
				let label = "[" + (build.failures.length - showCount)
					+ " more failures]"
				failures = failureSlice.map(renderFailure)
				failures.push(
					<li key="expand" className="failureExpand">
						<Icon src="images/error.png" /> {" "}
						<Clickable key="expand" label={label}
							handler={
								e => {
									this.setState({expand: true})
									invalidateUi()
								}
							} />
					</li>)
			} else {
				failures = build.failures.map(renderFailure)
			}

			if (failures.length)
				failureDisplay = <ul>{failures}</ul>
			else if (build.babysitterStatus.failed)
				failureDisplay = <i className="noLoad">(Test data did not load)</i>

			return <li key={key} className="buildResult">
				{buildLink} {formatDate(build.date)},{" "}
				<span className="buildResultString">{build.resultString()}</span> {" "}
				{failureDisplay}
			</li>
		} else {
			return <li key={key} className="buildResultNoLoad">
				{buildLink}: <i className="noLoad">(Could not load)</i>
			</li>
		}
	}
}

function linkPr(build: Build, title:boolean = false) {
	if (build.pr) {
		let titleDisplay = title ?
			[
				<span> </span>,
				<span className="prTitle">"{build.prTitle}"</span>
			] :
			null
		return <span className="prLink">(<A href={build.prUrl} title={build.prTitle}>PR {build.pr}</A>{titleDisplay})</span>
	} else {
		return null
	}
}

let ContentArea = React.createClass({
	render: function() {
		let readyLanes = filterLanes().filter(lane => lane.visible())
		let dateRange = new DateRange()

		if (readyLanes.length) {
			// FIXME: Don't do this all in one function...
			switch (groupBy.value) {

				// List of lanes, then builds under lanes, then failures under builds.
				case GroupBy.Lanes: {
					let laneDisplay = readyLanes.map(lane => {
						let builds = lane.builds()
						let loadedBuilds = builds.filter(build => build.loaded())
						let readyBuilds = loadedBuilds.filter(buildInTimespan).sort(
							(a:Build,b:Build) => (+b.date) - (+a.date))
						if (inProgressVisible.value == Visibility.Hide)
							readyBuilds = readyBuilds.filter(build => build.result != null)

						let loader = (loadedBuilds.length < builds.length) ?
							<li className="loading">{loadingIcon}</li> :
							null
						let buildList = readyBuilds.map(build => {
							dateRange.add(build.date) // Side effects in a map? Ew

							let linkLabel = "Build " + build.id
							return <BuildFailures build={build} key={build.id} linkLabel={linkLabel} extraLabel={linkPr(build)}/>
						})

						return <div className="verboseLane" key={lane.tag}>
							<A href={lane.displayUrl} title={null}>Lane {lane.name}</A>
							<ul>
								{buildList}
								{loader}
							</ul>
						</div>
					})

					return <div className="verboseLaneList">
						<p>Showing {formatRange(dateRange)}</p>
						{laneDisplay}
					</div>
				}

				// List of builds, then lanes under builds, then failures under lanes.
				case GroupBy.Builds: {
					let buildListings: {[key:string] : BuildListing} = {}
					for (let lane of readyLanes) {
						for (let build of lane.builds()) {
							if (!buildInTimespan(build))
								continue

							let buildListing = getOrDefault(buildListings, build.id,
									() => new BuildListing())

							if (build.failures.length)
								buildListing.failedLanes++
							if (build.result == null)
								buildListing.inProgressLanes++

							dateRange.add(build.date)
							buildListing.dateRange.add(build.date)
							buildListing.lanes[lane.idx] = build
						}
					}

					if (inProgressVisible.value == Visibility.Hide) {
						let filteredBuildListings: {[key:string] : BuildListing} = {}
						for (let key of Object.keys(buildListings)) {
							let value = buildListings[key]
							if (value.inProgressLanes == 0) // TODO: Demand a certain # of lanes
								filteredBuildListings[key] = value
						}
						buildListings = filteredBuildListings
					}

					let buildDisplay = Object.keys(buildListings).sort(
							(a:string,b:string) => { // Sort by date
								let ad = buildListings[a].dateRange.late
								let bd = buildListings[b].dateRange.late
								return ((+bd) - (+ad))
							}
						).map(buildKey => {
						let extra: JSX.Element = null
						let buildListing = buildListings[buildKey]
						let laneDisplay = Object.keys(buildListing.lanes).sort(numericSort).map(laneIdx => {
							let build = buildListing.lanes[laneIdx]
							let lane = lanes[laneIdx]

							if (build.pr && !extra)
								extra = linkPr(build)

							return <BuildFailures build={build} key={lane.idx} linkLabel={lane.name} extraLabel={null} />
						})

						return <div className="verboseBuild" key={buildKey}>
							<b>Build {buildKey}</b> {extra}
							<ul>
								{laneDisplay}
							</ul>
						</div>
					})

					let failCount = objectValues(buildListings)
						.filter(buildListing => buildListing.failedLanes > 0)
						.length

					return <div className="verboseBuildList">
						<p>Showing {formatRange(dateRange)} | <b>{failCount} of {countKeys(buildListings)}</b> builds have failures:</p>
						<div className="buildList">
							{buildDisplay}
						</div>
					</div>
				}

				// List of failures, then builds under failures, then lanes under builds.
				case GroupBy.Failures: {
					let failureListings: {[key:string] : FailureListing} = {}
					let uniqueBuilds: { [id:string]: boolean } = {}
					let trials = 0

					for (let lane of readyLanes) {
						for (let build of lane.builds()) {
							if (build.result == null || !buildInTimespan(build))
								continue

							trials++
							dateRange.add(build.date)
							uniqueBuilds[build.id] = true

							for (let failure of build.failures) {
								let failureKey = failure.key()
								let failureListing = getOrDefault(failureListings, failureKey,
									() => new FailureListing(failure))
								failureListing.dateRange.add(build.date)
								failureListing.count++
								failureListing.lanes[lane.idx] = true
								failureListing.builds[build.id] = true
							}
						}
					}
					let failureDisplay = Object.keys(failureListings)
						.sort( (a:string,b:string) => failureListings[b].count - failureListings[a].count )
						.map( key => {
							let failureListing = failureListings[key]
							let failure = failureListing.obj
							let title = failure.test ?
								<div>
										<div className="failedTestName">{failure.test}</div>
										while running <span className="invocation">{failure.step}</span>
								</div> :
								<div className="invocation">{failure.step}</div>

							return <li className="failure" key={key}>
								{title}
								<b>{failureListing.count}</b> failure{failureListing.count>1?"s":""}{" "}
								(failed on {countKeys(failureListing.builds)}/{countKeys(uniqueBuilds)} builds,{" "}
								{countKeys(failureListing.lanes)}/{readyLanes.length} lanes)
							</li>
						})

					return <div>
						<p>Showing {formatRange(dateRange)} | Out of <b>{trials}</b> runs:</p>
						<ul className="failureList">
							{failureDisplay}
						</ul>
					</div>
				}
			}
		} else {
			return null
		}
	}
})

let needRender = false
function render() {
	let inProgressChoice = groupBy.value != GroupBy.Failures ?
		<span>{" "}|{" "}
			In progress <ChoiceVisibility enum={Visibility} data={inProgressVisible} value={inProgressVisible.value} />
		</span> :
		null

	ReactDOM.render(<div>
		<div className="pageTitle">Babysitter logs</div>
		<ReloadControl />
		<div>
			Group by: <ChoiceGroupBy enum={GroupBy} data={groupBy} value={groupBy.value} />
			<br />
			Timespan: <ChoiceDisplaySpan enum={DisplaySpan} data={displaySpan} value={displaySpan.value} />
			<br />
			Filters:
			PRs <ChoiceVisibility enum={Visibility} data={prVisible} value={prVisible.value} />
			{inProgressChoice}
		</div>
		<LoadingBox />
		<LaneErrorBox />
		<hr className="sectionDivider" />
		<ContentArea />
	</div>, document.getElementById('content'))
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
render()
