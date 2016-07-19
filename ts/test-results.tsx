/// <reference path="./test-download.ts" />
/// <reference path="./helper-react.tsx" />

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

	constructor(laneTag: string, id: string) {
		super(laneTag, id)
		this.failures = []
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

	interpretMetadata(json) {
		if ('debug' in options) console.log("Got metadata", json)

		this.date = new Date(+json.timestamp)
		this.result = json.result ? json.result : "(Unfinished)"
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

class ChoiceVisibility extends Choice<Visibility> {}
let prVisible = new Ref(Visibility.Show)

class ChoiceGroupBy extends Choice<GroupBy> {}
let groupBy = new Ref(GroupBy.Lanes)

// Utility

function filterLanes() {
	return lanes.filter( lane =>
		(prVisible.value == Visibility.Show || !lane.isPr)
	)
}

function formatDate(date: Date) {
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

// Listing containers

class Listing {
	dateRange: DateRange

	constructor() {
		this.dateRange = new DateRange()
	}
}

class BuildListing extends Listing {
	failedLanes: number
	lanes: { [laneIndex:number]: Build }

	constructor() {
		super()
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

let loadingIcon = <span><img className="icon" src="images/loading.gif" /> Loading...</span>

let LoadingBox = React.createClass({
	render: function() {
		let dirty = false
		for (let lane of filterLanes())
			if (!lane.status.loaded || lane.buildsRemaining > 0)
				dirty = true

		if (dirty)
			return <div className="loadingBox"><p>{loadingIcon}</p></div>
		else
			return <div>&nbsp;</div>
	}
})

let ErrorBox = React.createClass({
	render: function() {
		let errors = filterLanes().filter(lane => lane.status.failed)
		if (errors.length) {
			let errorDisplay = lanes.map(lane =>
				<div className="errorItem">
					<img className="icon" src="images/error.png" title={lane.apiUrl} />
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

function renderFailures(build: Build, buildLink: JSX.Element) {
	if (!build.metadataStatus.failed) {
		let failures = build.failures.map(renderFailure)
		let failureDisplay : JSX.Element = null

		if (failures.length)
			failureDisplay = <ul>{failures}</ul>
		else if (build.babysitterStatus.failed)
			failureDisplay = <i className="noLoad">(Test data did not load)</i>

		return <li key={build.id} className="buildResult">
			{buildLink} {formatDate(build.date)},{" "}
			<span className="buildResultString">{build.result}</span>
			{failureDisplay}
		</li>
	} else {
		return <li key={build.id} className="buildResultNoLoad">
			{buildLink}: <i className="noLoad">(Could not load)</i>
		</li>
	}
}

let ContentArea = React.createClass({
	render: function() {
		let readyLanes = filterLanes().filter(lane => lane.status.loaded)
		let dateRange = new DateRange()

		if (readyLanes.length) {
			// FIXME: Don't do this all in one function...
			switch (groupBy.value) {

				// List of lanes, then builds under lanes, then failures under builds.
				case GroupBy.Lanes: {
					let laneDisplay = readyLanes.map(lane => {
						let readyBuilds = lane.builds.filter(build => build.loaded())
						let loader = (readyBuilds.length < lane.builds.length) ?
							<li className="loading">{loadingIcon}</li> :
							null
						let buildList = readyBuilds.map(build => {
							let buildLink = <A href={build.displayUrl}>Build {build.id}</A>
							return renderFailures(build, buildLink)
						})

						return <div className="verboseLane" key={lane.tag}>
							<A href={lane.displayUrl}>Lane {lane.name}</A>
							<ul>
								{buildList}
								{loader}
							</ul>
						</div>
					})

					return <div className="verboseLaneList">
						{laneDisplay}
					</div>
				}

				// List of builds, then lanes under builds, then failures under lanes.
				case GroupBy.Builds: {
					let buildListings: {[key:string] : BuildListing} = {}
					for (let lane of readyLanes) {
						for (let build of lane.builds) {
							let buildListing = getOrDefault(buildListings, build.id,
									() => new BuildListing())

							if (build.failures.length)
								buildListing.failedLanes++

							dateRange.add(build.date)
							buildListing.lanes[lane.idx] = build
						}
					}
					let buildDisplay = Object.keys(buildListings).sort(numericSort).map(buildKey => {
						let buildListing = buildListings[buildKey]
						let laneDisplay = Object.keys(buildListing.lanes).sort(numericSort).map(laneIdx => {
							let build = buildListing.lanes[laneIdx]
							let lane = lanes[laneIdx]
							let buildLink = <A href={build.displayUrl}>{lane.name}</A>
							return renderFailures(build, buildLink)
						})

						return <div className="verboseBuild">
							<b>Build {buildKey}</b>
							<ul>
								{laneDisplay}
							</ul>
						</div>
					})

					let failCount = objectValues(buildListings)
						.filter(buildListing => buildListing.failedLanes > 0)
						.length

					return <div className="verboseBuildList">
						<p>{failCount} of {countKeys(buildListings)} builds have failures:</p>
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
						for (let build of lane.builds) {
							trials++
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
						.sort( (a,b) => failureListings[b].count - failureListings[a].count )
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
						<p>Out of {trials} runs:</p>
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
	ReactDOM.render(<div>
		<div><span className="pageTitle">Babysitter logs</span>
			<br />
			Group by: <ChoiceGroupBy enum={GroupBy} data={groupBy} value={groupBy.value} />
			<br />
			Filters: PRs <ChoiceVisibility enum={Visibility} data={prVisible} value={prVisible.value} />
		</div>
		<LoadingBox />
		<ErrorBox />
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