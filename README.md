Human readable display of Mono Jenkins logs.

To set up this project, run:

    npm install -g typescript tsd
    make tsd

Then to build, run:

    make

Site will be installed into `install/`.

To test:

* Because of a web browser security feature called CORS, the files from Jenkins this web app loads can only be loaded if the app is being served from jenkins.mono-project.com. This means if you want to test the app locally, you will need to disable CORS temporarily. I suggest using the [CORS toggle plugin](https://chrome.google.com/webstore/detail/cors-toggle/omcncfnpmcabckcddookmnajignpffnh?hl=en) for Chrome.

* Adding `#!debug` to the URL will run in a debug mode which prints verbose information to the js console.

# Licensing

The icons currently being used are from [https://www.iconfinder.com/iconsets/32x32-free-design-icons] and under that license if we post this publicly we have to include a link to [http://www.aha-soft.com/].

The throbber is from http://preloaders.net/ and has no license restrictions.

The Javascript libraries have licenses which mandate attribution:

* JQuery is under the [MIT license](https://github.com/jquery/jquery/blob/master/LICENSE.txt).
* React is under [BSD-3](https://github.com/facebook/react/blob/master/LICENSE).
* "lz-string" is under the ["WTFPL"](http://pieroxy.net/blog/pages/lz-string/index.html#inline_menu_10).
* "priorityqueuejs" is under the [MIT license](https://github.com/janogonzalez/priorityqueuejs)
