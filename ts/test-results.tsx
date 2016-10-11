/// <reference path="./test-download.ts" />
/// <reference path="./helper-react.tsx" />

const before_collapse_standard = 5
const before_collapse_pr = 100

// Constants

declare var overloadShowLaneCheckboxes : number
const showLaneCheckboxes = typeof overloadShowLaneCheckboxes !== 'undefined' ? overloadShowLaneCheckboxes : false

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

	equals(other:Failure) : boolean { // Allow match even if kind differs
		return this.step == other.step && this.test == other.test
	}
}

class MassFailure {
	constructor(public limit: number, public exampleFailure:Failure) {}
}

class MassFailureTracker {
	count:number
	massFailure: MassFailure

	constructor(massFailure: MassFailure) {
		this.count = 0
		this.massFailure = massFailure
	}

	feed(failure: Failure) {
		let targetFailure = this.massFailure.exampleFailure
		if (targetFailure.step == failure.step &&
			(!targetFailure.test || targetFailure.test == failure.test))
			this.count++
	}

	excess() {
		return this.count >= this.massFailure.limit
	}
}

// Here is a list of test suites which tend to fail all at once, and spuriously.
// For example if the X server dies, or the disk runs out of space, the result
// will be hundreds of failures of no informational value in the relevant suite.
let massFailures = [
	new MassFailure(1300,
		new Failure("make -w -C mcs/class/System.Windows.Forms run-test")
	)
]

// Load
class Build extends BuildStandard {
	failures: Failure[]
	massFailureTrackers: MassFailureTracker[]

	constructor(laneTag: string, id: string) {
		super(laneTag, id)
		this.failures = []
		this.massFailureTrackers = massFailures.map(f => new MassFailureTracker(f))
	}

	interpretMetadata(json) {
		if (hashHas('options')) console.log("Got metadata", json)

		super.interpretMetadata(json)
	}

	// See scripts/ci/babysitter in mono repo for json format
	interpretBabysitter(jsons: any[]) {
		if (hashHas('options')) console.log("Got babysitter", jsons)

		for (let json of jsons) {
			if (json.final_code) {
				let resolved = false
				if (json.babysitter_protocol || json.loaded_xml) {
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

						for (let tracker of this.massFailureTrackers)
							tracker.feed(failure)
					}
				}
				if (!resolved) {
					let failure = new Failure(json.invocation)
					if (json.final_code == "124")
						failure.kind = FailureKind.Hang
					this.failures.push(failure)
				}
			}
		}
	}

	massFailed() {
		return this.massFailureTrackers.some(tracker => tracker.excess())
	}
}

let lanes = makeLanes(Build)

// Display state

enum GroupBy {
	Lanes,
	Builds,
	PRs,
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
let prVisible = new HashRef("pr", Visibility, Visibility.Hide)
let massFailVisible = new HashRef("massFail", Visibility, Visibility.Show)
let inProgressVisible = new HashRef("inProgress", Visibility, Visibility.Hide)

class CheckboxVisibility extends Checkbox<Visibility> {}
let laneVisible : HashRef<Visibility>[] = null
if (showLaneCheckboxes)
	laneVisible = lanes.map(lane =>
		new HashRef(lettersOnly(lane.name), Visibility, Visibility.Show)
	)

class ChoiceGroupBy extends Choice<GroupBy> {}
let groupBy = new HashRef("groupBy", GroupBy, GroupBy.Lanes)

class ChoiceDisplaySpan extends Choice<DisplaySpan> {}
let displaySpan = new HashRef("span", DisplaySpan, DisplaySpan.Last48Hr)

let testFilterStep = new HashRef<string>("filterTestStep", null, null)
let testFilterTest = new HashRef<string>("filterTestCase", null, null)
let prFilter = new HashRef<string>("filterPr", null, null)

// Test filters

class TestFilter {
	constructor(public failure: Failure) {}

	match(build: Build) : boolean {
		for (let failure of build.failures) {
			if (this.failure.equals(failure))
				return true
		}
		return false
	}

	display() {
		if (this.failure.test)
			return <span className="failedTestName">{this.failure.test}</span>
		else
			return <span className="invocation">{this.failure.step}</span>
	}
}

// FIXME: This is a nasty hack.
function currentTestFilter() {
	return testFilterStep.value != null || testFilterTest.value != null
			? new TestFilter(new Failure(testFilterStep.value, testFilterTest.value))
			: null
}

// Utility

function filterLanes() {
	return lanes.filter( lane =>
		(prVisible.value == Visibility.Show || !lane.isPr
		 || groupBy.value == GroupBy.PRs)
	)
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

class BuildListing extends Listing {
	failedLanes: number
	inProgressLanes: number
	lanes: { [laneIndex:number]: Build }

	constructor() {
		super()
		this.inProgressLanes = 0
		this.failedLanes = 0
		this.lanes = emptyObject()
	}
}
interface BuildListingDict { [key:string] : BuildListing }

class PrListing extends Listing {
	builds: BuildListingDict

	constructor() {
		super()
		this.builds = emptyObject()
	}
}
interface PrListingDict { [key:string] : PrListing }

function filterBuildListingsForInProgress(buildListings: BuildListingDict) {
	let filteredBuildListings: BuildListingDict = emptyObject()
	for (let key of Object.keys(buildListings)) {
		let value = buildListings[key]
		if (value.inProgressLanes == 0) // TODO: Demand a certain # of lanes
			filteredBuildListings[key] = value
	}
	return filteredBuildListings
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
		this.builds = emptyObject()
		this.lanes = emptyObject()
	}
}
interface FailureListingDict { [key:string] : FailureListing }

let isMakeLine = /make (?:-j\d+ )?-w V=1/

function buildFailure(failure: Failure) {
	return failure.step && (
		   startsWith(failure.step, "./autogen.sh")
		|| isMakeLine.test( failure.step )
	)
}

// Return true if all failures are build failures
function anyNonBuildFailures(build: Build) {
	for(let failure of build.failures) {
		if (!buildFailure(failure))
			return true
	}
	return false
}

// Presentation

let LoadingBox = React.createClass({
	render: function() {
		if (currentlyLoading())
			return <div className="loadingBox">{loadingIcon}</div>
		else
			return <div>&nbsp;</div>
	}
})

let ReloadControl = makeReloadControl(lanes, currentlyLoading)

function showingOnly(display:JSX.Element, clear: ()=>void) {
	return <span> | Showing only {display} <Clickable label="[X]" key={null}
		handler={e => { // Note: Clears global handler
			clear()
			invalidateUi()
	}} /></span>
}

class TestFilterDisplayProps {
	testFilter: TestFilter
}
class TestFilterDisplay extends React.Component<TestFilterDisplayProps, {}> {
	render() {
		if (!this.props.testFilter || groupBy.value == GroupBy.Failures || groupBy.value == GroupBy.PRs)
			return null

		return showingOnly(this.props.testFilter.display(), () => {
			// Note: Clears global handler
			testFilterStep.clear()
			testFilterTest.clear()
		})
	}
}

class PrFilterDisplay extends React.Component<{}, {}> {
	render() {
		if (!prFilter.value || groupBy.value != GroupBy.PRs)
			return null

		return showingOnly(<b>PR {prFilter.value}</b>, () => {
			prFilter.clear()
		})
	}
}


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

class FailureFilterLinkProps {
	count: number
	of: number
	isLane: boolean
	failure: Failure
}

class FailureFilterLink extends React.Component<FailureFilterLinkProps, {}> {
	render() {
		let label = "" + this.props.count + "/" + this.props.of + " " +
			(this.props.isLane ? "lanes" : "builds")

		return <Clickable label={label} key={null} handler={
			e => {
				testFilterStep.set( this.props.failure.step )
				testFilterTest.set( this.props.failure.test )
				groupBy.set( this.props.isLane ? GroupBy.Lanes : GroupBy.Builds )
				invalidateUi()
			}
		} />
	}
}

function renderFailureBase(failure: Failure, extra:JSX.Element=null) {
	let testLine = failure.test ? <div className="failedTestName">{failure.test}</div> : null
	let key = failure.step + "!" + failure.test
	return <li key={key} className="failure">
		<div>
			{failureDescribe(failure.kind)} while running <span className="invocation">{failure.step}</span>
		</div>
		{testLine}
		{extra}
	</li>
}

function renderFailureStandard(failure: Failure) {
	return renderFailureBase(failure)
}

class BuildFailuresProps {
	lane: Lane<Build>
	build: Build
	key: string
	linkLabel: string
	extraLabel: JSX.Element
}

class ExpandableState {
	expand:boolean
}

class Expandable<Props, Item> extends React.Component<Props, ExpandableState> {
	constructor(props: Props) {
		super(props)
		this.state = {expand: false}
	}
	listRender(items:Item[]) {
		let itemDisplay: JSX.Element[]
		let renderItem = x => this.itemRender(x)
		let beforeCollapse = this.beforeFailureCount()

		if (!this.state.expand && items.length > beforeCollapse) {
			let showCount = beforeCollapse - 1 // Never show "1 more failures"
			let itemSlice = items.slice(0, showCount)
			itemDisplay = itemSlice.map(renderItem)
			itemDisplay.push(
				this.expandItemRender(items.length - showCount)
			)
		} else {
			itemDisplay = items.map(renderItem)
		}
		return itemDisplay
	}
	expandButtonRender(label:string) {
		return <Clickable key="expand" label={label}
			handler={
				e => {
					this.setState({expand: true})
					invalidateUi()
				}
			} />
	}

	// Overload these

	beforeFailureCount() { return 1 }
	itemRender(item:Item) : JSX.Element { return null }
	expandItemRender(failureCount:number) : JSX.Element { return null }
}

class ExpandableWithFailures<Props, Item> extends Expandable<Props, Item> {
	expandItemRender(failureCount: number) {
		let label = "[" + failureCount + " more failures]"
		return <li key="expand" className="failureExpand">
			<Icon src="images/error.png" /> {this.expandButtonRender(label)}
		</li>
	}
}

class BuildFailures extends ExpandableWithFailures<BuildFailuresProps, Failure> {
	render() {
		let build = this.props.build
		let key = this.props.key
		let buildLink = <span><A href={build.displayUrl} title={null}>{this.props.linkLabel}</A> {this.props.extraLabel}</span>

		if (!build.metadataStatus.failed) {
			let failureDisplay : JSX.Element = null
			let failures: JSX.Element[] = null

			if (build.failures.length)
				failureDisplay = <ul>{ this.listRender(build.failures) }</ul>
			else if (build.babysitterStatus.failed)
				failureDisplay = <i className="noLoad">(Test data did not load)</i>

			let linkJenkinsDisplay = anyNonBuildFailures(this.props.build)
				? linkJenkins(this.props.lane, this.props.build)
				: null

			return <li key={key} className="buildResult">
				{buildLink} {formatDate(build.date)},{" "}
				<span className="buildResultString">{build.resultString()}</span> {" "}
				{linkJenkinsDisplay}
				{failureDisplay}
			</li>
		} else {
			return <li key={key} className="buildResultNoLoad">
				{buildLink}: <i className="noLoad">(Could not load)</i>
			</li>
		}
	}

	beforeFailureCount() { return before_collapse_standard }
	itemRender(failure:Failure) : JSX.Element { return renderFailureStandard(failure) }
}

function linkFor(build: Build, parens=true, allowPrTitle=true) {
	let title = build.prTitle ? build.prTitle : build.gitHash
	let display = build.pr && allowPrTitle ? `PR ${build.pr}` :  (parens?"":"Commit ") + build.gitDisplay()
	return <span className="sourceLink">{parens?"(":""}<A href={build.gitUrl(allowPrTitle)} title={title}>{display}</A>{parens?")":""}</span>
}

function linkJenkins(lane: Lane<Build>, build: Build) {
	let title = "Test results on Jenkins"
	let url = jenkinsBuildBaseUrl(lane.tag, build.id) + "/testReport"
	return <span>(<A href={url} title={title}>Failures</A>)</span>
}

function extractFailuresFromBuild(lane:Lane<Build>, build:Build, dateRange:DateRange, failureListings:FailureListingDict, uniqueBuilds:BooleanDict) {
	dateRange.add(build.date)
	uniqueBuilds[build.buildTag()] = true

	for (let failure of build.failures) {
		if (buildFailure(failure))
			continue

		let failureKey = failure.key()
		let failureListing = getOrDefault(failureListings, failureKey,
			() => new FailureListing(failure))
		failureListing.dateRange.add(build.date)
		failureListing.count++
		failureListing.lanes[lane.idx] = true
		failureListing.builds[build.buildTag()] = true
	}
}

let ContentArea = React.createClass({
	render: function() {
		let readyLanes = filterLanes().filter(
			lane => lane.visible() &&
				(!laneVisible || laneVisible[lane.idx].value == Visibility.Show)
		)
		let dateRange = new DateRange()
		let testFilter = currentTestFilter()

		if (readyLanes.length) {
			// FIXME: Don't do this all in one function...
			switch (groupBy.value) {

				// List of lanes, then builds under lanes, then failures under builds.
				case GroupBy.Lanes: {
					let laneDisplay = readyLanes.map(lane => {
						let builds = lane.builds()
						let loadedBuilds = builds.filter(build => build.loaded())
						let readyBuilds = loadedBuilds.filter(buildInTimespan)

						if (inProgressVisible.value == Visibility.Hide)
							readyBuilds = readyBuilds.filter(build => !build.inProgress())
						if (massFailVisible.value == Visibility.Hide)
							readyBuilds = readyBuilds.filter(build => !build.massFailed())
						if (testFilter) {
							readyBuilds = readyBuilds.filter(build => testFilter.match(build))

							// HACK: Hide this lane in the lane display
							if (!readyBuilds.length)
								return null
						}

						readyBuilds = readyBuilds.sort(
							(a:Build,b:Build) => (+b.date) - (+a.date))

						let loader = (loadedBuilds.length < builds.length)
							? <li className="loading">{loadingIcon}</li>
							: null
						let buildList = readyBuilds.map(build => {
							dateRange.add(build.date) // Side effects in a map? Ew

							let linkLabel = "Build " + build.id
							return <BuildFailures lane={lane} build={build} key={build.id} linkLabel={linkLabel} extraLabel={linkFor(build)} />
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
					let buildListings: BuildListingDict = emptyObject()
					for (let lane of readyLanes) {
						for (let build of lane.builds()) {
							if (!buildInTimespan(build))
								continue
							if (massFailVisible.value == Visibility.Hide && build.massFailed())
								continue
							if (testFilter && !testFilter.match(build))
								continue

							let buildListing = getOrDefault(buildListings, build.buildTag(),
									() => new BuildListing())

							if (build.failures.length)
								buildListing.failedLanes++
							if (build.inProgress())
								buildListing.inProgressLanes++

							dateRange.add(build.date)
							buildListing.dateRange.add(build.date)
							buildListing.lanes[lane.idx] = build
						}
					}

					// Filtering for "in progress" happens late because all lanes must be scanned first
					if (inProgressVisible.value == Visibility.Hide)
						buildListings = filterBuildListingsForInProgress(buildListings)

					let buildDisplay = Object.keys(buildListings).sort(dateRangeLaterCmpFor(buildListings)).map(buildKey => {
						let extra: JSX.Element = null
						let buildListing = buildListings[buildKey]
						let laneDisplay = Object.keys(buildListing.lanes).sort(numericSort).map(laneIdx => {
							let build = buildListing.lanes[laneIdx]
							let lane = lanes[laneIdx]

							if (!extra)
								extra = linkFor(build, false)

							return <BuildFailures lane={lane} build={build} key={lane.idx} linkLabel={lane.name} extraLabel={null} />
						})

						if (!extra)
							extra = <span>Unknown</span>

						return <div className="verboseBuild" key={buildKey}>
							<b>{extra}</b>
							<ul>
								{laneDisplay}
							</ul>
						</div>
					})

					let failDisplay: JSX.Element = null

					if (!testFilter) {
						let failCount = objectValues(buildListings)
							.filter(buildListing => buildListing.failedLanes > 0)
							.length
						failDisplay = <span> | <b>{failCount} of {countKeys(buildListings)}</b> builds have failures:</span>
					}

					return <div className="verboseBuildList">
						<p>Showing {formatRange(dateRange)}{failDisplay}</p>
						<div className="buildList">
							{buildDisplay}
						</div>
					</div>
				}

				// List of failures, then builds under failures, then lanes under builds.
				case GroupBy.Failures: {
					let failureListings: FailureListingDict = emptyObject()
					let uniqueBuilds: BooleanDict = emptyObject()
					let trials = 0

					for (let lane of readyLanes) {
						for (let build of lane.builds()) {
							if (build.inProgress() || !buildInTimespan(build))
								continue
							if (massFailVisible.value == Visibility.Hide && build.massFailed())
								continue

							trials++
							extractFailuresFromBuild(lane, build, dateRange, failureListings, uniqueBuilds)
						}
					}
					let failureDisplay = Object.keys(failureListings)
						.sort( (a:string,b:string) => failureListings[b].count - failureListings[a].count )
						.map( key => {
							let failureListing = failureListings[key]
							let failure = failureListing.obj
							let title = failure.test
								? <div>
										<div className="failedTestName">{failure.test}</div>
										while running <span className="invocation">{failure.step}</span>
								  </div>
								: <div className="invocation">{failure.step}</div>

							return <li className="failure" key={key}>
								{title}
								<b>{failureListing.count}</b> failure{failureListing.count>1?"s":""}{" "}
								(failed on <FailureFilterLink count={countKeys(failureListing.lanes)}
									of={readyLanes.length} isLane={true} failure={failure} />
									; <FailureFilterLink count={countKeys(failureListing.builds)}
									of={countKeys(uniqueBuilds)} isLane={false} failure={failure} />
								)
							</li>
						})

					return <div>
						<p>Showing {formatRange(dateRange)} | Out of <b>{trials}</b> runs:</p>
						<ul className="failureList">
							{failureDisplay}
						</ul>
					</div>
				}

				// List of PRs, which in practice is similar to a list of builds, but with access to extended failure info
				case GroupBy.PRs: {
					let failureListings: FailureListingDict = emptyObject()
					let uniqueBuilds: BooleanDict = emptyObject()
					let prListings: PrListingDict = emptyObject()
					let trials = 0

					// FIXME: Some code duplication here. Can this be merged?
					for (let lane of readyLanes) {
						for (let build of lane.builds()) {
							// Filter builds
							if (lane.isPr && prFilter.value) {
								// FIXME: Should builds that took place after the PR build be filtered?
								if (build.pr != prFilter.value)
									continue
							} else {
								if (!buildInTimespan(build))
									continue
								if (massFailVisible.value == Visibility.Hide && build.massFailed())
									continue
							}

							// Process builds
							if (lane.isPr) {
								let prListing = getOrDefault(prListings, build.pr,
									() => new PrListing())
								let buildListing = getOrDefault(prListing.builds, build.buildTag(),
									() => new BuildListing())

								if (build.failures.length)
									buildListing.failedLanes++
								if (build.inProgress())
									buildListing.inProgressLanes++

//								dateRange.add(build.date)
								buildListing.dateRange.add(build.date)
								buildListing.lanes[lane.idx] = build
							} else {
								if (build.inProgress())
									continue

								trials++
								extractFailuresFromBuild(lane, build, dateRange, failureListings, uniqueBuilds)
							}
						}
					}

					if (!prFilter.value && inProgressVisible.value == Visibility.Hide) {
						let filteredPrListings: PrListingDict = emptyObject()
						for (let key of Object.keys(prListings)) {
							let value = prListings[key]
							let buildListings = filterBuildListingsForInProgress(value.builds)
							if (objectSize(buildListings) > 0) {
								value.builds = buildListings // KLUDGE: This mutates the old value
								filteredPrListings[key] = value
							}
						}
						prListings = filteredPrListings
					}

					function renderFailure(failure:Failure) {
						let failureListing = failureListings[failure.key()]

						let extra:JSX.Element = null

						if (buildFailure(failure)) {
							extra = <div>
								PR caused failure? <span className="failedTestVerdict">Probably, this is a build failure</span>
							</div>
						} else if (!failureListing || failureListing.count == 0) {
							extra = <div>
								Recently failed on <b>0/{trials} runs</b>;{" "}
								<b>0/{readyLanes.length} lanes</b>; <b>0/{countKeys(uniqueBuilds)} builds</b>
								<br />
								PR caused failure? <span className="failedTestVerdict">Probably</span>, no other recent failures
							</div>
						} else {
							let verdict:JSX.Element = null

							if (failure.test) {
								verdict = <span><b>Probably not</b>, other recent failures</span>
							} else {
								verdict = <span><b>Maybe</b>, recent failures in same suite may or may not be the same</span>
							}

							extra = <div>
								Recently failed on <b>{failureListing.count}/{trials} runs</b>;{" "}
								<FailureFilterLink count={countKeys(failureListing.lanes)}
								of={readyLanes.length} isLane={true} failure={failure} />
								; <FailureFilterLink count={countKeys(failureListing.builds)}
								of={countKeys(uniqueBuilds)} isLane={false} failure={failure} />
								<br />
								PR caused failure? {verdict}
								<br />
								<span className="datetime">Most recent failure: {failureListing.dateRange.late ? formatDate(failureListing.dateRange.late) : <span>never</span>}</span>
							</div>
						}

						return renderFailureBase(failure, extra)
					}

					let prDisplay = Object.keys(prListings).sort(dateRangeLaterCmpFor(prListings)).map(prKey => {
						let prListing = prListings[prKey]
						let buildListings = prListing.builds
						let prExtra : JSX.Element = null

						let buildDisplay = Object.keys(buildListings).sort(dateRangeLaterCmpFor(buildListings)).map(buildKey => {
							let extra: JSX.Element = null
							let buildListing = buildListings[buildKey]
							let laneDisplay = Object.keys(buildListing.lanes).sort(numericSort).map(laneIdx => {
								let build = buildListing.lanes[laneIdx]
								let lane = lanes[laneIdx]

								if (!prExtra)
									prExtra = <p>
										<b>{linkFor(build, false)}</b>, {build.prAuthor}: <b>{build.prTitle}</b>
									</p>

								if (!extra)
									extra = <p><b>{linkFor(build, false, false)}</b></p>

								return <BuildFailures lane={lane} build={build} key={lane.idx} linkLabel={lane.name} extraLabel={null} />
							})

							if (!extra)
								extra = <span>Unknown</span>

							return <div className="verbosePr" key={buildKey}>
								{extra}
								<ul>
									{laneDisplay}
								</ul>
							</div>
						})

						// FIXME: Don't blockquote, use a div with a left margin
						return <div key={prKey}>
							{prExtra}
							<blockquote>
								{buildDisplay}
							</blockquote>
						</div>
					})

					return <div>
						<p>Are the failures in this PR new? Comparing builds from {formatRange(dateRange)}</p>
						{prDisplay}
					</div>
				}
			}
		}

		return null
	}
})

registerRender( () => {
	let inProgressChoice = groupBy.value != GroupBy.Failures
		? <span>
			{" "}|{" "}
			In progress <ChoiceVisibility enum={Visibility} data={inProgressVisible} value={inProgressVisible.value} />
		  </span>
		: null
	let prChoice = groupBy.value != GroupBy.PRs
		? <span>
			{" "}|{" "}
			PRs <ChoiceVisibility enum={Visibility} data={prVisible} value={prVisible.value} />
		  </span>
		: null

	let laneCheckboxDisplay = null
	if (laneVisible) {
		let laneCheckboxes : JSX.Element[] = []
		for (let idx in lanes) {
			let lane = lanes[idx]
			if (lane.isPr && prVisible.value == Visibility.Hide)
				continue
			let value = laneVisible[idx]
			laneCheckboxes.push(<span className="checkboxContainer">
				<CheckboxVisibility enum={Visibility} data={value} value={value.value}
					on={Visibility.Show} off={Visibility.Hide}
					label={lane.name} /> {" "}
			</span>)
		}
		laneCheckboxDisplay = <div><br /><div className="checkboxGrid">{laneCheckboxes}</div></div>
	}

	ReactDOM.render(<div>
		<TitleBar />
		<br />
		<ReloadControl />
		<div>
			Group by: <ChoiceGroupBy enum={GroupBy} data={groupBy} value={groupBy.value} />
			<br />
			Timespan: <ChoiceDisplaySpan enum={DisplaySpan} data={displaySpan} value={displaySpan.value} />
			<br />
			Filters:
			Mass-fails <ChoiceVisibility enum={Visibility} data={massFailVisible} value={massFailVisible.value} />
			{prChoice}
			{inProgressChoice}
			<TestFilterDisplay testFilter={currentTestFilter()} />
			<PrFilterDisplay />
			{laneCheckboxDisplay}
		</div>
		<LoadingBox />
		<LaneErrorBox />
		<hr className="sectionDivider" />
		<ContentArea />
	</div>, document.getElementById('content'))
})
render()
