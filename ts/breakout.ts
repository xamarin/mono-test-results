// Quick js helper that detects if we are running in a frame and breaks out.
// The Jenkins plugin does this; it's annoying and blocks us from using #anchors

if (top.location != self.location) {
	top.location.href = self.location.href
}
