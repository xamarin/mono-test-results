all:
	mkdir -p js
	tsc -p ts

clean:
	rm -f js/*