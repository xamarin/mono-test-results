/// <reference path="./test-download.ts" />
/// <reference path="./helper-react.tsx" />

const before_collapse_standard = 5
const before_collapse_pr = 8

// Constants

declare var overloadShowLaneCheckboxes : number
const showLaneCheckboxes = typeof overloadShowLaneCheckboxes !== 'undefined' ? overloadShowLaneCheckboxes : false

// Load

enum FailureKind {
    Unknown,
    Build,
    Test,
    Crash,
    Hang
}

function failureDescribe(kind: FailureKind) {
	switch (kind) {
		case FailureKind.Build:
			return "Build failure"
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

// PRs and normal builds set this differently.
// We need to normalize step strings by removing it.
let ciPrSanitizer = /\s+CI_PR=\d*$/

class Failure {
	step: string
	test: string
	kind: FailureKind

	constructor(step:string, test:string = null) {
		if (step)
			step = step.replace(ciPrSanitizer, "")

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

// Some failure steps have different labels from lane to lane. This collapses
// known-identical steps into a single string-matchable name.
// This might not be the best way to do this.
// FIXME: NO MATTER WHAT, CHANGE THIS ONCE BTLS BECOMES THE DEFAULT ON LINUX
let failureStepRemap = emptyObject()
failureStepRemap["make -w -C mcs/class/System run-test"] =
	"bash -c export MONO_TLS_PROVIDER=legacy && make -w -C mcs/class/System run-test"

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
				let invocation = json.invocation
				if (invocation in failureStepRemap)
					invocation = failureStepRemap[invocation]

				if (json.babysitter_protocol || json.loaded_xml) {
					for(let testName in json.tests) {
						let failure = new Failure(invocation, testName)
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
					let failure = new Failure(invocation)
					if (json.final_code == "124")
						failure.kind = FailureKind.Hang
					else if (buildFailure(failure))
						failure.kind = FailureKind.Build
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
let prGithubFilter = new HashRef<string>("filterGithubUserPr", null, null)

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

interface BuildDict { [laneIndex:number]: Build }

class BuildListing extends Listing {
	failedLanes: number
	inProgressLanes: number
	lanes: BuildDict

	constructor() {
		super()
		this.inProgressLanes = 0
		this.failedLanes = 0
		this.lanes = emptyObject()
	}
}
interface BuildListingDict { [key:string] : BuildListing }

enum PrSuspicion {
	Build,
	Probably,
	Maybe,
	ProbablyNot,
	NoErrors
}

class PrFailure {
	lanes: BuildDict

	constructor(public failureListing:FailureListing) {
		this.lanes = emptyObject()
	}

	suspicionCache: PrSuspicion
	suspicion() {
		if (this.suspicionCache == null) {
			let failure = this.failureListing.failure
			if (buildFailure(failure)) {
				this.suspicionCache = PrSuspicion.Build
			} else if (this.failureListing.count == 0) {
				this.suspicionCache = PrSuspicion.Probably
			} else if (!failure.test) {
				this.suspicionCache = PrSuspicion.Maybe
			} else {
				this.suspicionCache = PrSuspicion.ProbablyNot
			}
		}
		return this.suspicionCache
	}
}

interface PrFailureDict { [key:string]:PrFailure }

function anyBuildFrom(buildDict: BuildDict) {
	for (let key of Object.keys(buildDict))
		return buildDict[key]
	return null
}

class PrBuildListing extends Listing {
	lanes: BuildDict
	lanesInProgress: BuildDict
	lanesAborted: BuildDict
	failureDict: PrFailureDict

	constructor() {
		super()
		this.lanes = emptyObject()
		this.lanesInProgress = emptyObject()
		this.lanesAborted = emptyObject()
		this.failureDict = emptyObject()
	}

	// Late population
	sortedKeysCache: string[]
	sortedKeys() {
		if (!this.sortedKeysCache)
			this.sortedKeysCache = Object.keys(this.failureDict).sort(
				(a, b) =>
					this.failureDict[a].suspicion() - this.failureDict[b].suspicion()
			)
		return this.sortedKeysCache
	}

	sampleBuildCache: Build
	sampleBuild() {
		if (!this.sampleBuildCache) {
			this.sampleBuildCache = anyBuildFrom(this.lanes)
			if (!this.sampleBuildCache)
				this.sampleBuildCache = anyBuildFrom(this.lanesInProgress)
			if (!this.sampleBuildCache)
				this.sampleBuildCache = anyBuildFrom(this.lanesAborted)
		}
		return this.sampleBuildCache
	}

	suspicionCache: PrSuspicion
	suspicion() {
		if (this.suspicionCache == null) {
			this.suspicionCache = PrSuspicion.NoErrors
			for (let prFailure of objectValues(this.failureDict)) {
				this.suspicionCache = Math.min(this.suspicionCache, prFailure.suspicion())
			}
		}
		return this.suspicionCache
	}
}

interface PrBuildListingDict { [key:string] : PrBuildListing }

class PrListing extends Listing {
	builds: PrBuildListingDict

	constructor() {
		super()
		this.builds = emptyObject()
	}

	// Late population
	sortedKeysCache: string[]
	sortedKeys() {
		if (!this.sortedKeysCache)
			this.sortedKeysCache = Object.keys(this.builds).sort(dateRangeLaterCmpFor(this.builds))
		return this.sortedKeysCache
	}

	sampleBuildCache: Build
	sampleBuild() {
		if (!this.sampleBuildCache) {
			for (let key of this.sortedKeys()) {
				this.sampleBuildCache = this.builds[key].sampleBuild()
				if (this.sampleBuildCache)
					break
			}
		}
		return this.sampleBuildCache
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

	constructor(public failure: Failure) {
		super()
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

// UI to display/dismiss a test filter
function showingOnly(display:JSX.Element, clear: ()=>void) {
	return <span> | Showing only {display} <Clickable label="[X]" key={null}
		handler={e => { // Note: Clears global handler
			clear()
			invalidateUi()
	}} /></span>
}

// UI to enter a new filter string
class FilterEntryProps {
	label: string
	filterRef: HashRef<string>
}

class FilterEntryState {
	input: string
}

class FilterEntry extends React.Component<FilterEntryProps, FilterEntryState> {
	constructor(props: FilterEntryProps) {
		super(props)
		this.state = {input: null}
	}

	render() {
		return <span>
			Filter by {this.props.label}:{" "}
			<form onSubmit={ (evt) => {
				let input = this.state.input
				this.setState({input: null})
				this.props.filterRef.set(input)

				evt.preventDefault() // Don't submit!
			}} className="inlineForm">
				<input value={this.state.input} onChange={ (evt) => {
					this.setState({input: (evt.target as any).value})
				}} /> {" "}
				<input type="submit" value="Search" />
			</form>
		</span>
	}
}

// UI to show current filters on build/lane panes
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

// UI to show current filters on PR lane
function clearPrFilters() {
	prFilter.clear()
	prGithubFilter.clear()
}

let PrFilterDisplay = React.createClass({
	render: function() {
		if (groupBy.value != GroupBy.PRs)
			return null

		if (prFilter.value) {
			return showingOnly(<b>PR {prFilter.value}</b>, clearPrFilters)
		} else if (prGithubFilter.value) {
			return showingOnly(<b>GitHub user {prGithubFilter.value}</b>, clearPrFilters)
		} else {
			return <span>
				{" "} | <FilterEntry label="PR#" filterRef={prFilter} />
				{" "} | <FilterEntry label="GitHub handle" filterRef={prGithubFilter} />
			</span>
		}
	}
})

let LaneErrorBox = React.createClass({
	render: function() {
		let errors = filterLanes().filter(lane => lane.status.failed)
		if (errors.length) {
			let errorDisplay = errors.map(lane =>
				<div className="errorItem" key={lane.name}>
					<Icon src="images/error.png" />
					Failed to load index for lane <b>{lane.name}</b>
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

		// TODO: Never show "1 more failures" for failure listings
		if (!this.state.expand && items.length > beforeCollapse) {
			let showCount = beforeCollapse
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

	// Display one failure
	itemRender(failure:Failure) : JSX.Element {
		return renderFailureStandard(failure)
	}
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

function linkLanesDiv(title:string, dict:BuildDict, linkFailures = false, bold = false) {
	if (!dict || objectSize(dict) == 0)
		return null

	let links:JSX.Element[] = []
	for (let idx in dict) {
		let lane = lanes[idx]
		let build = dict[idx]
		if (links.length > 0)
			links.push(<span key={""+idx+"bar"}>, </span>)
		let url = jenkinsBuildBaseUrl(lane.tag, build.id)
		let title = (linkFailures ? "Failure" : "Build") + " results on Jenkins"
		if (linkFailures)
			 url += "/testReport"
		links.push(<A href={url} title={title} key={idx}>{lane.name}</A>)
	}
	let className = bold ? "highlightedLanesList" : "lanesList"
	return <div><span className={className}>{title}:</span> {links}</div>
}

// "State of the world" data shared by all failure displays
interface PrDisplayContext {
	trials:number
	builds:number
	lanes:number
}

class PrBuildDisplayProps {
	prBuildKey: string
	prBuildListing: PrBuildListing
	prDisplayContext:PrDisplayContext
}

class PrBuildDisplay extends ExpandableWithFailures<PrBuildDisplayProps, string> {
	render() {
		let prFailuresSortedKeys = this.props.prBuildListing.sortedKeys()
		let prFailureDisplay = this.listRender(prFailuresSortedKeys)
		return <ul>
			{prFailureDisplay}
		</ul>
	}

	// Display one failure
	itemRender(prFailureKey: string) {
		let prFailure = this.props.prBuildListing.failureDict[prFailureKey]
		let suspicionMessage: JSX.Element = null
		let otherFailures:JSX.Element = null
		let shouldShowOtherFailures = false

		switch (prFailure.suspicion()) {
			case PrSuspicion.Build:
				suspicionMessage = <span className="failedTestVerdict">Probably, this is a build failure</span>
				break;
			case PrSuspicion.Probably:
				suspicionMessage = <span className="failedTestVerdict">Probably, test failure is new</span>
				break;
			case PrSuspicion.Maybe:
				shouldShowOtherFailures = true
				suspicionMessage = <span><b className="iffyTestVerdict">Maybe</b>, test suite has failed recently but this may or may not be the same</span>
				break;
			case PrSuspicion.ProbablyNot:
				shouldShowOtherFailures = true
				suspicionMessage = <span><b>Probably not</b>, failure has been seen before</span>
				break;
			case PrSuspicion.NoErrors:
				suspicionMessage = <span>[???]</span>
				break;
		}

		let failureListing = prFailure.failureListing
		let failure = failureListing.failure
		let context = this.props.prDisplayContext
		if (failureListing.count > 0) {
			otherFailures = <p>
				Recently failed on <b>{failureListing.count}/{context.trials} runs</b>;{" "}
				<FailureFilterLink count={countKeys(failureListing.lanes)}
				of={context.lanes} isLane={true} failure={failure} />
				; <FailureFilterLink count={countKeys(failureListing.builds)}
				of={context.builds} isLane={false} failure={failure} />
				<br />
				{formatRangeLaterWithLabel(failureListing.dateRange, "Most recent failure")}
			</p>
		}

		let extra = <div>
			{linkLanesDiv("Failed on", prFailure.lanes, true)}
			<div>PR caused failure? {suspicionMessage}</div>
			{otherFailures}
		</div>
		return renderFailureBase(prFailure.failureListing.failure, extra)
	}

	beforeFailureCount() { return before_collapse_pr }
}

class PrDisplayProps {
	prKey: string
	prListing: PrListing
	prDisplayContext:PrDisplayContext
}

class PrDisplay extends Expandable<PrDisplayProps, string> {
	render() {
		let prBuildListings = this.props.prListing.builds
		let prBuildSortedKeys = this.props.prListing.sortedKeys()
		let sampleBuild = this.props.prListing.sampleBuild()
		let prDisplay = this.listRender(prBuildSortedKeys)

		let prTitle: JSX.Element = null
		if (sampleBuild) {
			prTitle = <p>
				<b>{linkFor(sampleBuild, false)}</b>, {sampleBuild.prAuthor}: <b>{sampleBuild.prTitle}</b>
			</p>
		} else {
			prTitle = <span>PR {this.props.prKey} [could not display]</span>
		}

		return <div key={this.props.prKey}>
			{prTitle}
			<ul className="prBuilds">
				{prDisplay}
			</ul>
		</div>
	}

	// Display one commit's PR data
	itemRender(prBuildKey: string) {
		let prBuildListing = this.props.prListing.builds[prBuildKey]
		let sampleBuild = prBuildListing.sampleBuild()

		let commitTitle: JSX.Element = null
		if (sampleBuild) {
			commitTitle = <div>
				<b>{linkFor(sampleBuild, false, false)}</b>
				<br />
				{formatRangeLaterWithLabel(prBuildListing.dateRange, "Last built")}
			</div>
		} else {
			commitTitle = <span>Commit {prBuildKey} [could not display]</span>
		}

		let result:JSX.Element = null
		if (objectSize(prBuildListing.failureDict) > 0) {
			let suspicionMessage: JSX.Element = null
			switch (prBuildListing.suspicion()) {
				case PrSuspicion.Build:
					suspicionMessage = <span className="failedTestVerdict">Probably broken, at least one build failed</span>
					break;
				case PrSuspicion.Probably:
					suspicionMessage = <span className="failedTestVerdict">Probably broken, there are new test failures</span>
					break;
				case PrSuspicion.Maybe:
					suspicionMessage = <span><b className="iffyTestVerdict">Maybe broken</b>, a suite failed which has failed before-- but it's not known if it's for the same reason</span>
					break;
				case PrSuspicion.ProbablyNot:
					suspicionMessage = <span><b>Probably okay</b>, all failures have been seen before</span>
					break;
				case PrSuspicion.NoErrors:
					suspicionMessage = <span>[???]</span>
					break;
			}

			result = <div className="prTestFailures">
				<div>PR is: {suspicionMessage}</div>
				<p><b>Failures:</b></p>
				<PrBuildDisplay prBuildKey={prBuildKey} prBuildListing={prBuildListing} prDisplayContext={this.props.prDisplayContext} />
			</div>
		} else {
			let label:string = null

			if (objectSize(prBuildListing.lanesInProgress))
				label = "No test failures (yet)"
			else
				label = "No test failures!"

			result = <div className="prTestFailures">
				<ul className="fakeTestFailuresList"><li className="ok"><b>{label}</b></li></ul>
			</div>
		}

		// TODO: Status
		return <li className="verbosePr" key={prBuildKey}>
			{commitTitle}
			{linkLanesDiv("Built on", prBuildListing.lanes)}
			{linkLanesDiv("Build in progress", prBuildListing.lanesInProgress)}
			{linkLanesDiv("Aborted early on", prBuildListing.lanesAborted, false, true)}
			{result}
		</li>
	}

	expandItemRender(failureCount:number) : JSX.Element {
		let label = "[" + failureCount + " more commit" +
			(failureCount>1?"s":"") + " for PR " + this.props.prKey + "]"
		return <li key="expand" className="prExpand">
			{this.expandButtonRender(label)}
		</li>
	}
}

// Used when constructing a failureListingsDict
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
							let failure = failureListing.failure
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
					let prFailureListings: PrFailureDict
					let trials = 0

					// FIXME: Some code duplication here. Can this be merged?
					for (let lane of readyLanes) {
						for (let build of lane.builds()) {
							// Filter builds
							if (lane.isPr && prFilter.value) {
								// FIXME: Should builds that took place after the PR build be filtered?
								if (build.pr != prFilter.value)
									continue
							} else if (lane.isPr && prGithubFilter.value) {
								if (build.prAuthor != prGithubFilter.value)
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

								let prBuildListing = getOrDefault(prListing.builds, build.buildTag(),
									() => new PrBuildListing())

								if (build.inProgress())
									prBuildListing.lanesInProgress[lane.idx] = build
								else if (build.result == "ABORTED")
									prBuildListing.lanesAborted[lane.idx] = build
								else
									prBuildListing.lanes[lane.idx] = build

								// Note: Suspicion is not rated on this pass
								for (let failure of build.failures) {
									let failureKey = failure.key()
									let prFailureListing = getOrDefault(prBuildListing.failureDict,
										failureKey, () => {
											// If a new failure listing is created in this path, its count, etc will be 0
											let failureListing = getOrDefault(failureListings, failureKey,
												() => new FailureListing(failure))
											return new PrFailure(failureListing)
									})
									prFailureListing.lanes[lane.idx] = build
								}

								prListing.dateRange.add(build.date)
								prBuildListing.dateRange.add(build.date)
							} else {
								if (build.inProgress())
									continue

								trials++
								extractFailuresFromBuild(lane, build, dateRange, failureListings, uniqueBuilds)
							}
						}
					}

					let prDisplayContext = {
						trials: trials,
						builds: countKeys(uniqueBuilds),
						lanes: readyLanes.length
					}

					let prDisplay = Object.keys(prListings).sort(dateRangeLaterCmpFor(prListings)).map(prKey => {
						let prListing = prListings[prKey]
						return <PrDisplay key={prKey} prKey={prKey} prListing={prListing} prDisplayContext={prDisplayContext} />
					})

					return <div>
						<p>Are the failures in the PR new? Comparing builds from {formatRange(dateRange)}</p>
						{prDisplay}
					</div>
				}
			}
		}

		return null
	}
})

registerRender( () => {
	let inProgressChoice = groupBy.value != GroupBy.Failures && groupBy.value != GroupBy.PRs
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

	// FIXME: This is a bit heaviweight and should be moved to a component.
	let laneCheckboxDisplay = null
	if (laneVisible) {
		let laneCheckboxes : JSX.Element[] = []
		let laneButtons : JSX.Element[] = []

		function pushLaneButtons(label:string, filter:(lane:Lane<Build>)=>boolean) {
			function makeHandler(sign:boolean) {
				return () => {
					let anythingChanged = false
					for (let idx in lanes) {
						let lane = lanes[idx]
						if (filter(lane)) {
							laneVisible[idx].set(sign ? Visibility.Show : Visibility.Hide)
							anythingChanged = true
						}
					}
					if (anythingChanged)
						invalidateUi()
				}
			}
			laneButtons.push(<span key={label+"Label"}>{
				laneButtons.length == 0 ? " " : " | "
			}<b>{label}</b> </span>)
			laneButtons.push(<Clickable key={label+"On"} label="On" handler={makeHandler(true)}/>)
			laneButtons.push(<span key={label+"Spacer2"}>, </span>)
			laneButtons.push(<Clickable key={label+"Off"} label="Off" handler={makeHandler(false)}/>)
		}
		pushLaneButtons("All",      (lane)=>true)
		pushLaneButtons("Standard", (lane)=>lane.isCore)
		pushLaneButtons("Windows",  (lane)=>lane.name.indexOf("Windows") >= 0)
		pushLaneButtons("Coop",     (lane)=>lane.name.indexOf("Coop") >= 0)
		// pushLaneButtons("Hybrid",   (lane)=>lane.name.indexOf("HybridAOT") >= 0) // TODO
		pushLaneButtons("AOT",      (lane)=>lane.name.indexOf("FullAOT") >= 0)

		for (let idx in lanes) {
			let lane = lanes[idx]
			if (lane.isPr && prVisible.value == Visibility.Hide)
				continue
			let value = laneVisible[idx]
			laneCheckboxes.push(<span className="checkboxContainer" key={idx}>
				<CheckboxVisibility enum={Visibility} data={value} value={value.value}
					on={Visibility.Show} off={Visibility.Hide}
					label={lane.name} /> {" "}
			</span>)
		}
		laneCheckboxDisplay = <div><br /><div>Lane filters:<span className="laneFilterButtons">{laneButtons}</span></div><div className="checkboxGrid">{laneCheckboxes}</div></div>
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
