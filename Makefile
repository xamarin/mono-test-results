REACT_VERSION = 0.14.3
ifdef DEBUG
	REACT_URL     = https://fb.me/react-$(REACT_VERSION).js
	REACT_DOM_URL = https://fb.me/react-dom-$(REACT_VERSION).js
else
	REACT_URL     = https://fb.me/react-$(REACT_VERSION).min.js
	REACT_DOM_URL = https://fb.me/react-dom-$(REACT_VERSION).min.js
endif

all: js/testresults.js js/react-dom.js js/react.js

js/react.js:
	mkdir -p js
	curl -L $(REACT_URL) > $@

js/react-dom.js:
	mkdir -p js
	curl -L $(REACT_DOM_URL) > $@

js/testresults.js: ts/testresults.tsx
	mkdir -p js
	tsc -p ts

clean:
	rm -f js/*