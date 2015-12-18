REACT_VERSION = 0.14.3
JQUERY_VERSION = 2.1.4
ifdef DEBUG
	REACT_URL     = https://fb.me/react-$(REACT_VERSION).js
	REACT_DOM_URL = https://fb.me/react-dom-$(REACT_VERSION).js
	JQUERY_URL    = http://code.jquery.com/jquery-$(JQUERY_VERSION).js
else
	REACT_URL     = https://fb.me/react-$(REACT_VERSION).min.js
	REACT_DOM_URL = https://fb.me/react-dom-$(REACT_VERSION).min.js
	JQUERY_URL    = http://code.jquery.com/jquery-$(JQUERY_VERSION).js
endif

all: js/testresults.js js/react-dom.js js/react.js js/jquery.js

tsd:
	tsd init
	tsd install react-global jquery --save

js/react.js:
	mkdir -p js
	curl -L $(REACT_URL) > $@

js/react-dom.js:
	mkdir -p js
	curl -L $(REACT_DOM_URL) > $@

js/jquery.js:
	mkdir -p js
	curl -L $(JQUERY_URL) > $@

js/testresults.js: ts/testresults.tsx
	mkdir -p js
	tsc -p ts

clean:
	rm -f js/*
