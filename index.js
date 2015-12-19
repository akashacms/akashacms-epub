/**
 * AkashaEPUB - akashacms-epub
 *
 * Copyright 2015 David Herron
 *
 * This file is part of AkashaCMS-epub (http://akashacms.com/).
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

var path      = require('path');
var util      = require('util');
var url       = require('url');
var async     = require('async');
var uuid      = require('node-uuid');
var ejs       = require('ejs');
var fs        = require('fs-extra');
var globfs    = require('globfs');
var mime      = require('mime');
var yaml      = require('js-yaml');
var archiver  = require('archiver');
var sprintf   = require("sprintf-js").sprintf,
    vsprintf  = require("sprintf-js").vsprintf;
var jsdom     = require('jsdom');
// IGNORE var epubcheck = require('epubcheck');

var rendererXmlEjs = require('./lib/render-xmlejs');
var rendererOpfEjs = require('./lib/render-opfejs');
var rendererNcxEjs = require('./lib/render-ncxejs');
var rendererEpubContainer = require('./lib/render-epubcontainer');

var logger;

/**
 * prepareConfig - Simplify the configuration object by filling in defaults
 *      that make sense for blogPodcast sites.
 */
module.exports.prepareConfig = function(akashacms, config) {
    
    if (!config) {
        config = {};
    }
    config = akashacms.prepareConfig(config);
    
    config.cheerio = {
        recognizeSelfClosing: true,
        recognizeCDATA: true,
        xmlMode: true
    };
    
    if (!config.config) {
        config.config = function(akasha) {
            akasha.registerPlugins([ { name: 'akashacms-epub', plugin: module.exports } ]);
        };
    }
    
    if (!config.akashacmsEPUB) config.akashacmsEPUB = {};
    if (config.akashacmsEPUB.metadataFile) {
        config.akashacmsEPUB.bookmetadata = yaml.safeLoad(fs.readFileSync(config.akashacmsEPUB.metadataFile, 'utf8'));
    }
    
    if (config.akashacmsEPUB.bookmetadata.stylesheets) {
        config.akashacmsEPUB.bookmetadata.stylesheets.forEach(function(cssentry) {
            config.headerScripts.stylesheets.push(cssentry);
        });
    }
    if (config.akashacmsEPUB.bookmetadata.javaScriptTop) {
        config.akashacmsEPUB.bookmetadata.javaScriptTop.forEach(function(jsentry) {
            config.headerScripts.javaScriptTop.push(jsentry);
        });
    }
    if (config.akashacmsEPUB.bookmetadata.javaScriptBottom) {
        config.akashacmsEPUB.bookmetadata.javaScriptBottom.forEach(function(jsentry) {
            config.headerScripts.javaScriptBottom.push(jsentry);
        });
    }
    
    return config;
};

/**
 * startup - Simplify configuration for a Blog using Grunt
 */
module.exports.startup = function(akashacms, config) {
    
    module.exports.prepareConfig(akashacms, config);
    
    // Now that we've prepared the config object, call akashacms.config
    akashacms.config(config);
};

/**
 * Add ourselves to the config data.
 **/
module.exports.config = function(akasha, config) {
	logger = akasha.getLogger("epub");
    
    logger.info('akashacms-epub');
    
    config.root_layouts.push(path.join(__dirname, 'layouts'));
    config.root_partials.push(path.join(__dirname, 'partials'));
    config.root_assets.unshift(path.join(__dirname, 'assets'));
    
    if (config.root_epub2) {
        config.root_docs.push(config.root_epub2);
    }
    
    if (config.root_epub3) {
        config.root_docs.push(config.root_epub3);
    }
    
    rendererEpubContainer.config(akasha);
    
    /* if (!config.akashacmsEPUB.files) {
        config.akashacmsEPUB.files = { // Provide a default if not given
            opf: "ebook.opf",
            epub: "ebook.epub"
        };
    } */
    if (!config.akashacmsEPUB) config.akashacmsEPUB = {};
    if (!config.akashacmsEPUB.metadata) config.akashacmsEPUB.metadata = {};
    if (!config.akashacmsEPUB.manifest) config.akashacmsEPUB.manifest = [];
    if (!config.akashacmsEPUB.opfspine) config.akashacmsEPUB.opfspine = [];
    
    [ rendererEpubContainer, rendererXmlEjs, rendererOpfEjs, rendererNcxEjs ].forEach(function(renderer) {
		akasha.registerRenderChain(renderer);
	});
    
    module.exports.assetManifestEntries = _assetManifestEntries.bind(null, akasha, config);
    module.exports.bundleEPUB = _bundleEPUB.bind(null, config);
    module.exports.ePubConfigCheck = _ePubConfigCheck.bind(null, config);
    module.exports.makeContainerXml = _makeContainerXml.bind(null, akasha, config);
    module.exports.makeCoverFiles = _makeCoverFiles.bind(null, akasha, config);
    module.exports.makeMetaInfDir = _makeMetaInfDir.bind(null, config);
    module.exports.makeMimetypeFile = _makeMimetypeFile.bind(null, config);
    module.exports.makeOPFNCX = _makeOPFNCX.bind(null, akasha, config);
    module.exports.makeOPF = _makeOPF.bind(null, akasha, config);
    module.exports.makeTOC = _makeTOC.bind(null, akasha, config);
    module.exports.scanForBookMetadata = _scanForBookMetadata.bind(null, akasha, config);
    
    akasha.emitter.on('file-rendered', function(config, entryPath, renderTo, rendered, done) {
        akasha.mahabhuta.process(rendered.content, {
            documentPath: entryPath
        }, postRenderMahafuncs, function(err, newrendered) {
            if (err) done(err);
            else { rendered.content = newrendered; done(); }
        });
    });
    
    module.exports.mahabhuta = [
        
        function(akasha, config, $, metadata, dirty, done) {
            logger.trace('ak-stylesheets');
            var elements = [];
            $('ak-stylesheets').each(function(i, elem) { elements.push(elem); });
            async.eachSeries(elements,
            function(element, next) {
                var scripts;
                if (typeof metadata.headerStylesheetsAdd !== "undefined") {
                    scripts = config.headerScripts.stylesheets.concat(metadata.headerStylesheetsAdd);
                } else {
                    scripts = config.headerScripts.stylesheets;
                }
                var mscripts = scripts.map(function(current, indx, origArray) {
                    return {
                        id: current.id,
                        href: rewriteURL(akasha, config, metadata, current.href, false) // MAP THIS URL
                    };
                });
                akasha.partial("ak_stylesheets.html.ejs", {
                    stylesheets: mscripts
                }, function(err, style) {
                    if (err) { logger.error(err); next(err); }
                    else {
                        $(element).replaceWith(style);
                        next();
                    }
                });
            },
            done);
        }.bind(null, akasha, config),
        
        function(akasha, config, $, metadata, dirty, done) {
            logger.trace('ak-headerJavaScript');
            var elements = [];
            $('ak-headerJavaScript').each(function(i, elem) { elements.push(elem); });
            async.eachSeries(elements,
            function(element, next) {
                var scripts;
                if (typeof metadata.headerJavaScriptAddTop !== "undefined") {
                    scripts = config.headerScripts.javaScriptTop.concat(metadata.headerJavaScriptAddTop);
                } else {
                    scripts = config.headerScripts.javaScriptTop;
                }
                var mscripts = scripts.map(function(current, indx, origArray) {
                    return {
                        id: current.id,
                        src: rewriteURL(akasha, config, metadata, current.src, false) // MAP THIS URL
                    };
                });
                akasha.partial("ak_javaScript.html.ejs", { javaScripts: mscripts },
                        function(err, html) {
                            if (err) next(err);
                            else {
                                $(element).replaceWith(html);
                                next();
                            }
                        });
            },
            done);
        }.bind(null, akasha, config),
        
        function(akasha, config, $, metadata, dirty, done) {
            logger.trace('ak-footerJavaScript');
            var elements = [];
            $('ak-footerJavaScript').each(function(i, elem) { elements.push(elem); });
            async.eachSeries(elements,
            function(element, next) {
                var scripts;
                if (typeof metadata.headerJavaScriptAddBottom !== "undefined") {
                    scripts = config.headerScripts.javaScriptBottom.concat(metadata.headerJavaScriptAddBottom);
                } else {
                    scripts = config.headerScripts.javaScriptBottom;
                }
                var mscripts = scripts.map(function(current, indx, origArray) {
                    return {
                        id: current.id,
                        src: rewriteURL(akasha, config, metadata, current.src, false) // MAP THIS URL
                    };
                });
                akasha.partial("ak_javaScript.html.ejs", { javaScripts: mscripts },
                        function(err, html) {
                            if (err) next(err);
                            else {
                                $(element).replaceWith(html);
                                next();
                            }
                        });
            },
            done);
        }.bind(null, akasha, config),
        
        function(akasha, config, $, metadata, dirty, done) {
            logger.trace('img modifications');
            var elements = [];
            $('img').each(function(i, elem) { elements.push(elem); });
            async.eachSeries(elements,
            function(element, next) {
                var mapped = $(element).attr('ak-mapped');
                if (mapped && mapped === "yes") {
                    next();
                } else {
                    // logger.trace(util.inspect(element));
                    var src = $(element).attr('src');
                    // MAP src url
                    $(element).attr('src', rewriteURL(akasha, config, metadata, src, false));
                    $(element).attr('ak-mapped', "yes");
                    next();
                }
            },
            done);
        }.bind(null, akasha, config),
        
        function(akasha, config, $, metadata, dirty, done) {
            logger.trace('epub a/link modifications');
            
            var links = [];
            $('html body a').each(function(i, elem) { links.push(elem); });
            $('html head link').each(function(i, elem) { links.push(elem); });
            
            // if (links.length > 0) logger.trace(util.inspect(metadata));
            async.eachSeries(links,
            function(link, next) {
                
                var mapped = $(link).attr('ak-mapped');
                if (mapped && mapped === "yes") {
                    next();
                } else {
                    // logger.trace(util.inspect(link));
                    var href   = $(link).attr('href');
                    
                    if (href && href !== '#') {
                        var uHref = url.parse(href, true, true);
                        // We're only going to look at local links,
                        // no processing for external links
                        // no processing for hash links within the document (such as footnotes)
                        if (! uHref.protocol && !uHref.slashes && !uHref.host && uHref.pathname) {
                            
                            var fixedURL = rewriteURL(akasha, config, metadata, href, true);
                            logger.trace('org href '+ href +' fixed '+ fixedURL);
                            
                            $(link).attr('href', fixedURL); // MAP href
                            $(link).attr('ak-mapped', "yes");
                            
                            if (link.type === 'tag' && link.name === 'a') {
                                var linktext = $(link).text();
                                var docEntry = akasha.findDocumentForUrlpath(
                                                computeFullPath(akasha, config, metadata, fixedURL)
                                ); // FIX href
                                // logger.trace(href +' docEntry '+ docEntry);
                                if (!docEntry) {
                                    next(new Error('No document found for link '+ href));
                                } else if ((!linktext || linktext.length <= 0 || linktext === href)
                                 && $(link).children() <= 0
                                 && docEntry.frontmatter.yaml.title) {
                                    $(link).text(docEntry.frontmatter.yaml.title);
                                    next();
                                } else next();
                            } else next();
                        } else next();
                    } else next();
                }
            },
            done);
        }.bind(null, akasha, config)
    ];
    
    var postRenderMahafuncs = [
        function(akasha, config, $, metadata, dirty, done) {
            logger.trace('remove ak-mapped');
            var elements = [];
            $('html body a').removeAttr('ak-mapped');
            $('html body img').removeAttr('ak-mapped');
            $('html head link').removeAttr('ak-mapped');
            done();
        }.bind(null, akasha, config)
    ];

	return module.exports;
};

function computeFullPath(akasha, config, metadata, sourceURL) {
    logger.trace('computeFullPath '+ sourceURL);
	var urlSource = url.parse(sourceURL, true, true);
	if (urlSource.protocol || urlSource.slashes) {
        throw new Error("Got external URL when not allowed " + sourceURL);
    } else {
		var pRenderedUrl;
		var docpath;
		var docdir;
		if (!urlSource.pathname) {
		    return sourceURL;
		} else if (urlSource.pathname && urlSource.pathname.match(/^\//)) { // absolute URL
            return sourceURL;
        } else if (urlSource.pathname && urlSource.pathname.match(/^\.\//)) {
            pRenderedUrl = url.parse(metadata.rendered_url);
            docpath = pRenderedUrl.pathname;
            docdir = path.dirname(docpath);
            return path.normalize(docdir+'/'+sourceURL);
        } else if (urlSource.pathname && urlSource.pathname.match(/^\.\.\//)) {
            pRenderedUrl = url.parse(metadata.rendered_url);
            docpath = pRenderedUrl.pathname;
            docdir = path.dirname(docpath);
            return path.normalize(docdir+'/'+sourceURL);
        } else {
            pRenderedUrl = url.parse(metadata.rendered_url);
            docpath = pRenderedUrl.pathname;
            docdir = path.dirname(docpath);
            return path.normalize(docdir+'/'+sourceURL);
        }
    }
};

function rewriteURL(akasha, config, metadata, sourceURL, allowExternal) {
    logger.trace('rewriteURL '+ sourceURL);
	var urlSource = url.parse(sourceURL, true, true);
	logger.trace(util.inspect(urlSource));
	if (urlSource.protocol || urlSource.slashes) {
        if (!allowExternal) {
            throw new Error("Got external URL when not allowed " + sourceURL);
        } else return sourceURL;
    } else {
		var pRenderedUrl;
        if (urlSource.pathname && urlSource.pathname.match(/^\//)) { // absolute URL
            var prefix = computeRelativePrefixToRoot(metadata.rendered_url);
            // logger.trace('absolute - prefix for '+ metadata.rendered_url +' == '+ prefix);
            var ret = path.normalize(prefix+sourceURL);
            // logger.trace('Rewrote '+ sourceURL +' to '+ ret);
            return ret;
        } else {
            var ret = sourceURL; //   path.normalize(docdir+'/'+sourceURL);
            // logger.trace('Rewrote '+ sourceURL +' to '+ ret);
            return ret;
        }
        
        /* else if (urlSource.pathname.match(/^\.\//)) { // ./
            // pRenderedUrl = url.parse(metadata.rendered_url);
            // var docpath = pRenderedUrl.pathname;
            // var docdir = path.dirname(docpath);
            // logger.trace('Cur Dir - renderedURL '+ metadata.rendered_url +' docdir '+ docdir);
            var ret = sourceURL; // path.normalize(docdir+'/'+sourceURL);
            // logger.trace('Rewrote '+ sourceURL +' to '+ ret);
            return ret;
        } else if (urlSource.pathname.match(/^\.\.\//)) { // ../
            // pRenderedUrl = url.parse(metadata.rendered_url);
            // var docpath = pRenderedUrl.pathname;
            // var docdir = path.dirname(docpath);
            // logger.trace('Parent Dir - renderedURL '+ metadata.rendered_url +' docdir '+ docdir);
            var ret = sourceURL; // path.normalize(docdir+'/'+sourceURL);
            // logger.trace('Rewrote '+ sourceURL +' to '+ ret);
            return ret;
        } else { // anything else
            // logger.trace('anything else '+ metadata.rendered_url);
            // logger.trace(util.inspect(metadata));
            // pRenderedUrl = url.parse(metadata.rendered_url);
            // var docpath = pRenderedUrl.pathname;
            // var docdir = path.dirname(docpath);
            var ret = sourceURL; //   path.normalize(docdir+'/'+sourceURL);
            // logger.trace('Rewrote '+ sourceURL +' to '+ ret);
            return ret;
        } */
    }
};

function computeRelativePrefixToRoot(source) {
    var prefix = '';
    for (var parent = path.dirname(source); parent !== '.'; parent = path.dirname(parent)) {
        prefix += '../';
    }
    return prefix === '' ? './' : prefix;
};

/**
 * Construct manifest entries from files in the workspace
 */
function _assetManifestEntries(akasha, config, done) {
    
    // Stylesheet and JavaScript files are listed in the config
    config.headerScripts.stylesheets.forEach(function(cssentry) {
        config.akashacmsEPUB.manifest.push({
            id: cssentry.id,
            type: "text/css",
            href: rewriteURL(akasha, config, { rendered_url: config.akashacmsEPUB.bookmetadata.opf }, cssentry.href, false)  // MAP this URL
        });
    });

    config.headerScripts.javaScriptTop.concat(config.headerScripts.javaScriptBottom).forEach(function(jsentry) {
        config.akashacmsEPUB.manifest.push({
            id: jsentry.id,
            type: "application/javascript",
            href: rewriteURL(akasha, config, { rendered_url: config.akashacmsEPUB.bookmetadata.opf }, jsentry.href, false)  // MAP this URL
        });
    });
    
    // There had formerly been a list of allowed file extensions in globfs.operate
    //
    // Turns out to have been too restrictive because those who wanted to
    // include other kinds of files weren't free to do so.
    //
    // The purpose here is to add manifest entries for files that aren't documents
    // and aren't already in the manifest for any other reason.
    
    var assetNum = 0;
    globfs.operate(config.root_assets.concat(config.root_docs), [ "**/*" ],
        function(basedir, fpath, fini) {
            
            // logger.info('asset file '+ path.join(basedir, fpath));
            
            fs.stat(path.join(basedir, fpath), function(err, stats) {
                if (err || !stats) {
                    // Shouldn't get this, because globfs will only give us
                    // files which exist
                    fini(null);
                } else if (stats.isDirectory()) {
                    // Skip directories
                    fini(null);
                } else {
                    akasha.readDocumentEntry(fpath, function(err, docEntry) {
                        
                        if (docEntry) {
                            // We can skip document files because they'll get into the manifest
                            // through other means
                            fini(null);
                        } else {
                    
                            // We're not using the mime library for some
                            // file extensions because it gives
                            // incorrect values for the .otf and .ttf files
                            logger.trace('assetManifestEntries '+ basedir +' '+ fpath);
                            var mimetype;
                            if (fpath.match(/\.ttf$/i)) mimetype = "application/vnd.ms-opentype";
                            else if (fpath.match(/\.otf$/i)) mimetype = "application/vnd.ms-opentype";
                            else mimetype = mime.lookup(fpath);
                            
                            // Detect any files that are already in manifest
                            // Only add to manifest stuff which isn't already there
                            var inManifest = false;
                            config.akashacmsEPUB.manifest.forEach(function(item) {
                                if (item.href === fpath) {
                                    inManifest = true;
                                }
                            });
                            if (!inManifest) {
                                config.akashacmsEPUB.manifest.push({
                                    id: "asset" + assetNum++,
                                    type: mimetype,
                                    href: rewriteURL(akasha, config, {
                                        rendered_url: config.akashacmsEPUB.bookmetadata.opf
                                    }, fpath, false)
                                });
                            }
                            fini(null);
                        }
                    });
                }
            });
        },
        done);
};

/**
 * Construct the .epub file
 */
function _bundleEPUB(config, done) {
    
    var epubconfig = config.akashacmsEPUB;
    
    var archive = archiver('zip');
    
    var output = fs.createWriteStream(config.akashacmsEPUB.bookmetadata.epub);
            
    output.on('close', function() {
        logger.info(archive.pointer() + ' total bytes');
        logger.info('archiver has been finalized and the output file descriptor has closed.');
        done();
    });
    
    archive.on('error', function(err) {
      logger.info('*********** BundleEPUB ERROR '+ err);
      done(err);
    });
    
    archive.pipe(output);
    
    // The mimetype file must be the first entry, and must not be compressed
    archive.append(
        fs.createReadStream(path.join(config.root_out, "mimetype")),
        { name: "mimetype", store: true });
    archive.append(
        fs.createReadStream(path.join(config.root_out, "META-INF", "container.xml")),
        { name: path.join("META-INF", "container.xml") });
    archive.append(
        fs.createReadStream(path.join(config.root_out, config.akashacmsEPUB.bookmetadata.opf)),
        { name: config.akashacmsEPUB.bookmetadata.opf });
    // archive.append(
    //     fs.createReadStream(path.join(config.root_out, config.akashacmsEPUB.files.ncx)),
    //    { name: config.akashacmsEPUB.files.ncx });
    
    // logger.info(util.inspect(config.akashacmsEPUB.manifest));
    async.eachSeries(config.akashacmsEPUB.manifest,
        function(item, next) {
            // logger.info(util.inspect(item));
            // if (item.spinetoc !== true) { // this had been used to skip the NCX file
            archive.append(
                fs.createReadStream(path.join(config.root_out, item.href)),
                { name: item.href }
            );
            // }
            next();
        },
        function(err) {
            if (err) logger.error(err);
            logger.info('before finalize');
            archive.finalize();
        });
};

function _ePubConfigCheck(config, done) {
    
    async.series([
        function(next) {
            if (!config.akashacmsEPUB.bookmetadata.opf) next(new Error('no OPF file specified'));
            else next();
        },
        function(next) {
            if (!config.akashacmsEPUB.bookmetadata.identifiers) {
                config.akashacmsEPUB.bookmetadata.identifiers = [
                    { unique: true, idstring: "urn:uuid:" + uuid.v1() }
                ];
                next();
            } else {
                var uniqueCount = 0;
                config.akashacmsEPUB.bookmetadata.identifiers.forEach(function(identifier) {
                    if (typeof identifier.unique !== 'undefined' && identifier.unique !== null) uniqueCount++;
                });
                if (uniqueCount !== 1) next(new Error("There can be only one - unique identifier, that is, found="+ uniqueCount));
                else next();
            }
        },
        function(next) {
            var rightnow = w3cdate(new Date());
            if (!config.akashacmsEPUB.bookmetadata.published) config.akashacmsEPUB.bookmetadata.published = {};
            if (!config.akashacmsEPUB.bookmetadata.published.date) config.akashacmsEPUB.bookmetadata.published.date = rightnow;
            config.akashacmsEPUB.bookmetadata.published.modified = rightnow;
            next();
        },
        function(next) {
            if (config.akashacmsEPUB.bookmetadata.toc && config.akashacmsEPUB.bookmetadata.toc.href) next();
            else next(new Error("No toc entry"));
        }
    ],
    done);
};

function _makeContainerXml(akasha, config, done) {
    
    var rf = [];
    
    if (config.akashacmsEPUB.bookmetadata.opf) {
        rf.push({
            path: config.akashacmsEPUB.bookmetadata.opf, // MAP this URL
            type: 'application/oebps-package+xml'
        });
    }
    
    akasha.partial("container.xml.ejs", {
        rootfiles: rf
    }, function(err, html) {
        if (err) done(err);
        else {
            fs.writeFile(path.join(config.root_out, "META-INF", "container.xml"),
                         html, "utf8", done);
        }
    });
};

function _makeCoverFiles(akasha, config, done) {

    // Add cover image to manifests
    config.akashacmsEPUB.manifest.push({
        id: config.akashacmsEPUB.bookmetadata.cover.idImage,
        properties: "cover-image",
        href: rewriteURL(akasha, config, {
                rendered_url: config.akashacmsEPUB.bookmetadata.opf
            }, config.akashacmsEPUB.bookmetadata.cover.src, false),  // MAP this URL
        type: config.akashacmsEPUB.bookmetadata.cover.type
    });

    if (config.akashacmsEPUB.bookmetadata.cover.writeHtml) {
        // console.log(util.inspect(config.akashacmsEPUB.bookmetadata.cover.writeHtml));
        config.akashacmsEPUB.manifest.push({
            id: config.akashacmsEPUB.bookmetadata.cover.writeHtml.id,
            href: rewriteURL(akasha, config, {
                    rendered_url: config.akashacmsEPUB.bookmetadata.opf
                }, config.akashacmsEPUB.bookmetadata.cover.writeHtml.href, false), // MAP this URL
            type: "application/xhtml+xml"
        });
        config.akashacmsEPUB.opfspine.push({
            idref: config.akashacmsEPUB.bookmetadata.cover.writeHtml.id,
            linear: "yes"
        });
        // console.log(util.inspect('_makeCoverFiles '+ util.inspect(config.akashacmsEPUB.opfspine)));
        akasha.partial("cover.html.ejs", {
            src: rewriteURL(akasha, config, {
                    rendered_url: config.akashacmsEPUB.bookmetadata.opf
                }, config.akashacmsEPUB.bookmetadata.cover.src, false), // MAP this URL
            alt: config.akashacmsEPUB.bookmetadata.cover.alt,
            idImage: config.akashacmsEPUB.bookmetadata.cover.idImage
        }, function(err, html) {
            if (err) done(err);
            else fs.writeFile(path.join(config.root_out, config.akashacmsEPUB.bookmetadata.cover.writeHtml.href), html, "utf8", done);
        });
    } else done();
};

function _makeMetaInfDir(config, done) {
    fs.mkdirs(path.join(config.root_out, "META-INF"), done);
};

function _makeMimetypeFile(config, done) {
    fs.writeFile(path.join(config.root_out, "mimetype"), "application/epub+zip", "utf8", done);
};

function _makeOPFNCX(akasha, config, done) {
    
    // logger.info('_makeOPFNCX');
    
    var tocHtml;
    
    async.series([
        // read the designated TOC file (toc.html)
        function(next) {
            fs.readFile(path.join(config.root_out, config.akashacmsEPUB.bookmetadata.toc.href), 'utf8',
                function(err, data) {
                    if (err) next(err);
                    else {
                        // logger.info('read '+ path.join(config.root_out, config.akashacmsEPUB.bookmetadata.toc.href));
                        tocHtml = data;
                        next();
                    }
                });
        },
        // Look for the designated element for TOC -- nav > ol
        // Gather data required to support manifest and opfspine
        // gather data required to support toc.ncx.ejs
        function(next) {
            var doc = jsdom.jsdom(tocHtml, {});
            
            var navs = doc.getElementsByTagName("nav");
            var thenav;
            for (var navno = 0; navno < navs.length; navno++) {
                if (navs[navno].id === config.akashacmsEPUB.bookmetadata.toc.id) {
                    thenav = navs[navno];
                    break;
                }
            }
            if (!thenav) {
                return next(new Error('no <nav id="'+ config.akashacmsEPUB.bookmetadata.toc.id +'">'));
            }
            // logger.info('found nav');
            
            var topol;
            for (var navchild = 0; navchild < thenav.childNodes.length; navchild++) {
                if (thenav.childNodes[navchild].nodeName
                 && thenav.childNodes[navchild].nodeName.toUpperCase() === 'ol'.toUpperCase()
                 && thenav.childNodes[navchild].hasAttributes()
                 && thenav.childNodes[navchild].getAttribute('start')
                 && thenav.childNodes[navchild].getAttribute('type')) {
                    topol = thenav.childNodes[navchild];
                    break;
                }
            }
            if (!topol) {
                return next(new Error('no <nav><ol type= start=></ol></nav>'));
            }
            // logger.info('found topol');
            
            
            // cover image/file manifest and opfspine entries are added in _makeCoverFiles
            
            // Add specific manifest and opfspine entries for TOC and NCX files
            
            config.akashacmsEPUB.manifest.push({
                id: config.akashacmsEPUB.bookmetadata.toc.id,
                properties: "nav",
                type: "application/xhtml+xml",
                href: config.akashacmsEPUB.bookmetadata.toc.href
            });
            config.akashacmsEPUB.opfspine.push({
                idref: config.akashacmsEPUB.bookmetadata.toc.id,
                linear: "yes"
            });
            // logger.trace('_scanForBookMetadata '+ util.inspect(config.akashacmsEPUB.manifest));
            if (config.akashacmsEPUB.bookmetadata.ncx) {
                config.akashacmsEPUB.manifest.push({
                    id: config.akashacmsEPUB.bookmetadata.ncx.id,
                    type: "application/x-dtbncx+xml",
                    href: config.akashacmsEPUB.bookmetadata.ncx.href
                });
            }
            
            // Scan the nested tree of ol's to capture data for .manifest .opfspine and .chapters
            var spineorder = 0;
            function scanOL(ol) {
                // logger.info('scanOL ol.length='+ ol.childNodes.length);
                var chaps = [];
                for (var olno = 0; olno < ol.childNodes.length; olno++) {
                    var olchild = ol.childNodes[olno];
                    // logger.info('olchild.nodeName '+ olchild.nodeName);
                    if (olchild.nodeName && olchild.nodeName.toUpperCase() === 'li'.toUpperCase()) {
                        var section; // section refers to chapters or subchapters
                        var subchapters;
                        section = undefined;
                        subchapters = undefined;
                        for (var childno = 0; childno < olchild.childNodes.length; childno++) {
                            // logger.info('olchild.childNodes[childno].nodeName '+ olchild.childNodes[childno].nodeName);
                            if (olchild.childNodes[childno].nodeName
                             && olchild.childNodes[childno].nodeName.toUpperCase() === 'ol'.toUpperCase()) {
                                subchapters = scanOL(olchild.childNodes[childno]);
                            } else if (olchild.childNodes[childno].nodeName
                                    && olchild.childNodes[childno].nodeName.toUpperCase() === 'a'.toUpperCase()) {
                                var anchor = olchild.childNodes[childno];
                                
                                config.akashacmsEPUB.manifest.push({
                                    id: anchor.getAttribute('id'),
                                    type: "application/xhtml+xml",
                                    href: anchor.getAttribute('href')
                                });
                                
                                config.akashacmsEPUB.opfspine.push({
                                    idref: anchor.getAttribute('id'),
                                    linear: "yes"
                                });
                                
                                section = {
                                    id: anchor.getAttribute('id'),
                                    title: anchor.nodeValue,
                                    href: anchor.getAttribute('href'),
                                    type: "application/xhtml+xml",
                                    navclass: "book",
                                    spineorder: ++spineorder
                                };
                            }
                        }
                        if (!section) {
                            return next(new Error('<li> has no <a> children'))
                        }
                        if (subchapters) section.subchapters = subchapters;
                        chaps.push(section);
                    }
                }
                // logger.info(util.inspect(chaps));
                return chaps;
            };
            config.akashacmsEPUB.chapters = [];
            config.akashacmsEPUB.chapters = scanOL(topol);
            
            // logger.info(util.inspect(config.akashacmsEPUB.chapters));
            
            next();
        },
        // fill in manifest entries for asset files
        function(next) {
            _assetManifestEntries(akasha, config, next);
        },
        // do current _makeOPF function
        function(next) {
            akasha.partial("open-package.opf.ejs", {
                title: config.akashacmsEPUB.bookmetadata.title,
                languages: config.akashacmsEPUB.bookmetadata.languages,
                date: config.akashacmsEPUB.bookmetadata.published.date,
                modified: config.akashacmsEPUB.bookmetadata.published.modified,
                identifiers: config.akashacmsEPUB.bookmetadata.identifiers,
                subjects: config.akashacmsEPUB.bookmetadata.subjects,
                description: config.akashacmsEPUB.bookmetadata.description,
                format: config.akashacmsEPUB.bookmetadata.format,
                source: config.akashacmsEPUB.bookmetadata.source,
                creators: config.akashacmsEPUB.bookmetadata.creators,
                contributors: config.akashacmsEPUB.bookmetadata.contributors,
                publisher: config.akashacmsEPUB.bookmetadata.publisher,
                relation: config.akashacmsEPUB.bookmetadata.relation,
                coverage: config.akashacmsEPUB.bookmetadata.coverage,
                rights: config.akashacmsEPUB.bookmetadata.rights,
                ncx: config.akashacmsEPUB.bookmetadata.ncx,
                manifest: config.akashacmsEPUB.manifest,
                opfspine: config.akashacmsEPUB.opfspine
            }, function(err, html) {
                if (err) next(err);
                else {
                    // logger.info('writing '+ path.join(config.root_out, config.akashacmsEPUB.bookmetadata.opf));
                    fs.writeFile(path.join(config.root_out, config.akashacmsEPUB.bookmetadata.opf), html, "utf8", next);
                }
            });
        },
        // do current _makeTOC function
        function(next) {
            if (config.akashacmsEPUB.bookmetadata.ncx) {
                akasha.partial("toc.ncx.ejs", {
                    identifiers: config.akashacmsEPUB.bookmetadata.identifiers,
                    title: config.akashacmsEPUB.bookmetadata.title,
                    creators: config.akashacmsEPUB.bookmetadata.creators,
                    chapters: config.akashacmsEPUB.chapters
                }, function(err, html) {
                    if (err) next(err);
                    else {
                        // logger.info('writing '+ path.join(config.root_out, config.akashacmsEPUB.bookmetadata.ncx.href));
                        fs.writeFile(path.join(config.root_out, config.akashacmsEPUB.bookmetadata.ncx.href), html, "utf8", next);
                    }
                });
            } else next();
        }
    ],
    done);
};

function _makeOPF(akasha, config, done) {
    akasha.partial("open-package.opf.ejs", {
        title: config.akashacmsEPUB.bookmetadata.title,
        languages: config.akashacmsEPUB.bookmetadata.languages,
        date: config.akashacmsEPUB.bookmetadata.published.date,
        modified: config.akashacmsEPUB.bookmetadata.published.modified,
        identifiers: config.akashacmsEPUB.bookmetadata.identifiers,
        subjects: config.akashacmsEPUB.bookmetadata.subjects,
        description: config.akashacmsEPUB.bookmetadata.description,
        format: config.akashacmsEPUB.bookmetadata.format,
        source: config.akashacmsEPUB.bookmetadata.source,
        creators: config.akashacmsEPUB.bookmetadata.creators,
        contributors: config.akashacmsEPUB.bookmetadata.contributors,
        publisher: config.akashacmsEPUB.bookmetadata.publisher,
        relation: config.akashacmsEPUB.bookmetadata.relation,
        coverage: config.akashacmsEPUB.bookmetadata.coverage,
        rights: config.akashacmsEPUB.bookmetadata.rights,
        ncx: config.akashacmsEPUB.bookmetadata.ncx,
        manifest: config.akashacmsEPUB.manifest,
        opfspine: config.akashacmsEPUB.opfspine
    }, function(err, html) {
        if (err) done(err);
        else {
            fs.writeFile(path.join(config.root_out, config.akashacmsEPUB.bookmetadata.opf), html, "utf8", done);
        }
    });
};

function _makeTOC(akasha, config, done) {
    
    var tocEntry = akasha.findDocumentForUrlpath(config.akashacmsEPUB.bookmetadata.toc.href);
    
    async.series([
        function(next) {
            akasha.partial("toc-epub3.html.ejs", {
                // pageLayout: config.akashacmsEPUB.contents.toclayout,
                title: tocEntry.frontmatter.yaml.title,
                subTitle: tocEntry.frontmatter.yaml.subtitle,
                id: tocEntry.frontmatter.yaml.akashacmsEPUB.id,
                chapters: config.akashacmsEPUB.chapters,
                navtype: "toc",
                toctype: tocEntry.frontmatter.yaml.akashacmsEPUB.toctype,
                tocstart: tocEntry.frontmatter.yaml.akashacmsEPUB.tocstart
            },
            function(err, html) {
                if (err) next(err);
                else {
                    tocEntry.frontmatter.text += html;
                    next();
                }
            });
        },
        function(next) {
            if (config.akashacmsEPUB.bookmetadata.ncx) {
                akasha.partial("toc.ncx.ejs", {
                    identifiers: config.akashacmsEPUB.bookmetadata.identifiers,
                    title: config.akashacmsEPUB.bookmetadata.title,
                    creators: config.akashacmsEPUB.bookmetadata.creators,
                    chapters: config.akashacmsEPUB.chapters
                }, function(err, html) {
                    if (err) next(err);
                    else fs.writeFile(path.join(config.root_out, config.akashacmsEPUB.bookmetadata.ncx.href), html, "utf8", next);
                });
            } else next();
        }
    ],
    done);
};

function _scanForBookMetadata(akasha, config, done) {
    
    var tocEntry = akasha.findDocumentForUrlpath(config.akashacmsEPUB.bookmetadata.toc.href);
    // logger.trace(config.akashacmsEPUB.bookmetadata.toc.href +' '+ util.inspect(tocEntry));
    
    if (!tocEntry) {
        logger.error('did not find document for TOC '+ config.akashacmsEPUB.bookmetadata.toc.href);
        done(new Error('did not find document for TOC '+ config.akashacmsEPUB.bookmetadata.toc.href));
    } else if (!tocEntry.frontmatter.yaml.akashacmsEPUB.chapters) {
        logger.error("No Chapters entry in TOC metadata");
        done(new Error("No Chapters entry in TOC metadata"));
    } else {
        try {
            var chapters = tocEntry.frontmatter.yaml.akashacmsEPUB.chapters;
            
            config.akashacmsEPUB.chapters = [];
            
            chapters.forEach(function(chapter) {
                logger.trace('chapter '+ chapter);
                var chapterPath = computeFullPath(akasha, config, {
                        rendered_url: config.akashacmsEPUB.bookmetadata.toc.href
                    }, chapter);
                logger.trace('chapter '+ chapter +' '+ chapterPath);
                var chapEntry = akasha.findDocumentForUrlpath(chapter);
                if (!chapEntry) {
                    logger.error('No sectionEntry found for '+ chapter +' in '+ chapterPath);
                    throw new Error('No sectionEntry found for '+ chapter +' in '+ chapterPath);
                } else if (!chapEntry.frontmatter.yaml
                        || !chapEntry.frontmatter.yaml.akashacmsEPUB
                        || !chapEntry.frontmatter.yaml.akashacmsEPUB.id) {
                    logger.error('No id found for '+ chapter +' '+ chapterPath);
                    throw new Error('No id found for '+ chapter +' '+ chapterPath)
                }
                function sectionList(documentPath, sections) {
                    var ret = [];
                    sections.forEach(function(section) {
                        logger.trace('section '+ section);
                        var sectionPath = computeFullPath(akasha, config, {
                                rendered_url: documentPath
                            }, section);
                        logger.trace('section '+ section +' '+ sectionPath);
                        var sectionEntry = akasha.findDocumentForUrlpath(sectionPath);
                        if (!sectionEntry) {
                            logger.error('No sectionEntry found for '+ section +' '+ sectionPath);
                            throw new Error('No sectionEntry found for '+ section +' '+ sectionPath);
                        } else if (!sectionEntry.frontmatter.yaml
                                || !sectionEntry.frontmatter.yaml.akashacmsEPUB
                                || !sectionEntry.frontmatter.yaml.akashacmsEPUB.id) {
                            logger.error('No id found for '+ section +' '+ sectionPath);
                            throw new Error('No id found for '+ section +' '+ sectionPath);
                        }
                        // logger.trace(sectionPath +' '+ util.inspect(sectionEntry.frontmatter.yaml));
                        var sectionData = {
                            id: sectionEntry.frontmatter.yaml.akashacmsEPUB.id,
                            title: sectionEntry.frontmatter.yaml.title,
                            href: sectionPath, /* rewriteURL(akasha, config, {
                                    rendered_url: sectionPath
                                }, section, false), */ // MAP this URL
                            type: "application/xhtml+xml",
                            navclass: "book"
                        };
                        if (sectionEntry.frontmatter.yaml.akashacmsEPUB.sections) {
                            sectionData.subchapters = sectionList(sectionPath, sectionEntry.frontmatter.yaml.akashacmsEPUB.sections);
                        }
                        ret.push(sectionData);
                    });
                    return ret;
                }
                logger.trace(chapter +' '+ util.inspect(chapEntry.frontmatter.yaml));
                var chapData = {
                    id: chapEntry.frontmatter.yaml.akashacmsEPUB.id,
                    title: chapEntry.frontmatter.yaml.title,
                    href: chapterPath, /* rewriteURL(akasha, config, {
                                    rendered_url: chapterPath
                                }, chapter, false), */ // MAP this URL
                    type: "application/xhtml+xml",
                    navclass: "book"
                };
                if (chapEntry.frontmatter.yaml.akashacmsEPUB.sections) {
                    chapData.subchapters = sectionList(chapterPath, chapEntry.frontmatter.yaml.akashacmsEPUB.sections);
                }
                config.akashacmsEPUB.chapters.push(chapData);
            });
    
            config.akashacmsEPUB.manifest.push({
                id: tocEntry.frontmatter.yaml.akashacmsEPUB.id,
                properties: "nav",
                type: "application/xhtml+xml",
                href: rewriteURL(akasha, config, {
                        rendered_url: config.akashacmsEPUB.bookmetadata.opf
                    }, config.akashacmsEPUB.bookmetadata.toc.href, false)  // MAP this URL
            });
            config.akashacmsEPUB.opfspine.push({
                idref: tocEntry.frontmatter.yaml.akashacmsEPUB.id,
                linear: "yes"
            });
            // logger.trace('_scanForBookMetadata '+ util.inspect(config.akashacmsEPUB.manifest));
            if (config.akashacmsEPUB.bookmetadata.ncx) {
                config.akashacmsEPUB.manifest.push({
                    id: config.akashacmsEPUB.bookmetadata.ncx.id,
                    type: "application/x-dtbncx+xml",
                    href: rewriteURL(akasha, config, {
                            rendered_url: config.akashacmsEPUB.bookmetadata.opf
                        }, config.akashacmsEPUB.bookmetadata.ncx.href, false)   // MAP this URL
                });
            }
            
            var spineorder = 0;
            var fixChapters = function(chapter) {
                ++spineorder;
                chapter.spineorder = spineorder;
                
                // logger.trace(util.inspect(chapter));
                
                config.akashacmsEPUB.manifest.push({
                    id: chapter.id,
                    type: "application/xhtml+xml",
                    href: rewriteURL(akasha, config, {
                            rendered_url: config.akashacmsEPUB.bookmetadata.opf
                        }, chapter.href, false)  // MAP this URL
                });
                config.akashacmsEPUB.opfspine.push({
                    idref: chapter.id,
                    linear: "yes"
                });
                
                if (chapter.subchapters) {
                    chapter.subchapters.forEach(fixChapters);
                }
            };
            config.akashacmsEPUB.chapters.forEach(fixChapters);
            
            // logger.trace('_scanForBookMetadata #2 '+ util.inspect(config.akashacmsEPUB.manifest));
            done();
        } catch (err) {
            done(err);
        }
    }
};

/*
 * The user experience for this is very disappointing
module.exports.EPUBcheck = function(config, done) {
    var epubconfig = config.akashacmsEPUB;
    epubcheck(epubconfig.files.epub, {
        epubcheck: "java -jar /usr/bin/epubcheck"
    },
    function(err, details) {
        if (err) done(err);
        else done(null, details);
    });
};
*/

var w3cdate = function(date) {
    return sprintf("%04d-%02d-%02dT%02d:%02d:%02dZ",
           date.getUTCFullYear(),
          (date.getUTCMonth() + 1),
           date.getUTCDate(),
          (date.getUTCHours()),
          (date.getUTCMinutes() + 1),
          (date.getUTCSeconds() + 1)
    );
};

