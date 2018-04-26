REACT_VERSION = 0.14.3
JQUERY_VERSION = 2.1.4
LZ_VERSION = 1.4.4
PQ_VERSION = 1.0.0

# Types versions differ in npm from actual versions, for reasons currently unknown.
REACT_TYPES_VERSION = 15.6.7
REACT_DOM_TYPES_VERSION = 15.5.6
JQUERY_TYPES_VERSION = 2.0.48

ifdef DEBUG
	REACT_URL     = https://fb.me/react-$(REACT_VERSION).js
	REACT_DOM_URL = https://fb.me/react-dom-$(REACT_VERSION).js
else
	REACT_URL     = https://fb.me/react-$(REACT_VERSION).min.js
	REACT_DOM_URL = https://fb.me/react-dom-$(REACT_VERSION).min.js
endif

# To avoid having to set up webpack, download all libraries directly and include with <script>.
JQUERY_URL  = http://code.jquery.com/jquery-$(JQUERY_VERSION).js
LZ_URL = https://raw.githubusercontent.com/pieroxy/lz-string/$(LZ_VERSION)/libs/lz-string.min.js
PQ_URL = https://raw.githubusercontent.com/janogonzalez/priorityqueuejs/$(PQ_VERSION)/index.js

all: install/index.html install/style.css install/builds.html install/builds-plus.html install/builds-stress.html install/builds-profiler.html \
	 install/builds-2017-12.html \
	 install/builds-2018-02.html \
	 install/builds-2018-04.html \
	 install/js/test-results.js install/js/test-status.js install/js/test-download.js \
	 install/js/helper.js install/js/helper-react.js install/js/breakout.js \
	 install/js/react-dom.js install/js/react.js install/js/jquery.js \
	 install/js/lz.js install/js/priorityqueue.js

# Download and install TypeScript typings. TODO: Use packages.json with explicit versioning or "lockfile"
npm:
	npm i @types/react-dom@$(REACT_DOM_TYPES_VERSION) @types/react@$(REACT_TYPES_VERSION) @types/jquery@$(JQUERY_TYPES_VERSION)

# Copy all static files
install/index.html install/style.css install/builds.html install/builds-plus.html install/builds-stress.html install/builds-profiler.html install/builds-2017-12.html install/builds-2018-02.html install/builds-2018-04.html: static/index.html static/style.css static/builds.html static/builds-plus.html static/builds-stress.html static/builds-profiler.html static/builds-2017-12.html static/builds-2018-02.html static/builds-2018-04.html
	rsync -urhi --exclude=.DS_Store static/ install/

# Download required libraries from CDN URLs.
install/js/react.js:
	mkdir -p install/js
	curl -L $(REACT_URL) > $@

install/js/react-dom.js:
	mkdir -p install/js
	curl -L $(REACT_DOM_URL) > $@

install/js/jquery.js:
	mkdir -p install/js
	curl -L $(JQUERY_URL) > $@

install/js/lz.js:
	mkdir -p install/js
	curl -L $(LZ_URL) > $@

install/js/priorityqueue.js:
	mkdir -p install/js
	curl -L $(PQ_URL) > $@

# Compile TypeScript
install/js/test-results.js install/js/test-status.js install/js/test-download.js install/js/helper.js install/js/helper-react.js install/js/breakout.js: ts/tsconfig.json ts/test-results.tsx ts/test-status.tsx ts/test-download.ts ts/helper.ts ts/helper-react.tsx ts/breakout.ts
	mkdir -p install/js
	tsc -p ts

clean:
	rm -rf install/*
