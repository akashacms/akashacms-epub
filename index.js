/**
 * AkashaEPUB - akashacms-epub
 * 
 * Copyright 2015 David Herron
 * 
 * This file is part of AkashaCMS-embeddables (http://akashacms.com/).
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
var archiver  = require('archiver');
var sprintf   = require("sprintf-js").sprintf,
    vsprintf  = require("sprintf-js").vsprintf
// IGNORE var epubcheck = require('epubcheck');

var logger;
var akasha;
var config;


/**
 * Add ourselves to the config data.
 **/
module.exports.config = function(_akasha, _config) {
	akasha = _akasha;
	config = _config;
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
    
    if (!config.akashacmsEPUB.files) {
        config.akashacmsEPUB.files = { // Provide a default if not given
            opf: "ebook.opf",
            epub: "ebook.epub"
        };
    }
    if (!config.akashacmsEPUB.metadata) config.akashacmsEPUB.metadata = {};
    if (!config.akashacmsEPUB.manifest) config.akashacmsEPUB.manifest = [];
    if (!config.akashacmsEPUB.opfspine) config.akashacmsEPUB.opfspine = [];
    
    [ rendererEpubContainer, rendererXmlEjs, rendererOpfEjs, rendererNcxEjs ].forEach(function(renderer) {
		akasha.registerRenderChain(renderer);
	});
    
	return module.exports;
};

module.exports.mahabhuta = [
    
		function($, metadata, dirty, done) {
        	logger.trace('ak-stylesheets');
            var elements = [];
            $('ak-stylesheets').each(function(i, elem) { elements.push(elem); });
            async.eachSeries(elements,
            function(element, next) {
				if (typeof config.headerScripts !== "undefined") {
					akasha.partial("ak_stylesheets.html.ejs", {
						headerScripts: config.headerScripts 
					}, function(err, style) {
						if (err) { logger.error(err); next(err); }
						else {
							$(element).replaceWith(style);
							next();
						}
					});
				}
				else {
					$(element).remove();
					next();
				}
            }, 
            function(err) {
				if (err) {
					logger.error('ak-stylesheets Errored with '+ util.inspect(err));
					done(err);
				} else done();
            });
        },
		
    ];

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

module.exports.getEPUBmetadata = function(done) {
    return config.akashacmsEPUB;
};

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

module.exports.generateEPUBFiles = function(_akasha, _config, done) {
    var epubconfig = config.akashacmsEPUB;
    
    if (!config.akashacmsEPUB.files.opf) throw new Error('no OPF file specified');
    if (!config.akashacmsEPUB.rootfiles) {
        config.akashacmsEPUB.rootfiles = [ ];
    }
    
    if (!config.akashacmsEPUB.metadata.identifiers) {
        config.akashacmsEPUB.metadata.identifiers = [
            { unique: true, idstring: "urn:uuid:" + uuid.v1() }
        ];
    } else {
        var uniqueCount = 0;
        config.akashacmsEPUB.metadata.identifiers.forEach(function(identifier) {
            if (typeof identifier.unique !== 'undefined' && identifier.unique !== null) uniqueCount++;
        });
        if (uniqueCount !== 1) throw new Error("There can be only one - unique identifier, that is, found="+ uniqueCount);
    }
    
    var rightnow = new Date();
    if (!config.akashacmsEPUB.metadata.date)
        config.akashacmsEPUB.metadata.date = w3cdate(rightnow);
    config.akashacmsEPUB.metadata.modified = w3cdate(rightnow);
    
    // Fix the Chapters and subchapters
    
    var spineorder = 0;
    var fixChapters = function(chapter) {
        ++spineorder;
        chapter.spineorder = spineorder;
        chapter.title = module.exports.titleForManifestItem(chapter);
        if (chapter.subchapters) {
            chapter.subchapters.forEach(fixChapters);
        }
    };
    config.akashacmsEPUB.chapters.forEach(fixChapters);
    
    // logger.info('***** rootfiles ');
    
    // Files for META-INF/container.xml
    config.akashacmsEPUB.rootfiles.push({
        path: config.akashacmsEPUB.files.opf,
        type: "application/oebps-package+xml"
    });
    
    ////////// Create the file manifests
    
    // logger.info('******* Cover image');
    
    // Add cover image to manifests
    config.akashacmsEPUB.manifest.push({
        id: config.akashacmsEPUB.cover.id,
        href: "cover.html",
        type: "application/xhtml+xml"
    });
    config.akashacmsEPUB.opfspine.push({
        idref: config.akashacmsEPUB.cover.id,
        linear: "yes"
    });
    config.akashacmsEPUB.manifest.push({
        id: config.akashacmsEPUB.cover.idImage,
        properties: "cover-image",
        href: config.akashacmsEPUB.cover.src,
        type: config.akashacmsEPUB.cover.type
    });
    
    // logger.info('****** Table of Contents')
    
    // Add Table of Contents to manifests
    config.akashacmsEPUB.manifest.push({
        id: config.akashacmsEPUB.contents.id,
        properties: "nav",
        type: config.akashacmsEPUB.contents.type,
        href: config.akashacmsEPUB.contents.href
    });
    config.akashacmsEPUB.opfspine.push({
        idref: config.akashacmsEPUB.contents.id,
        linear: "yes"
    });
    if (config.akashacmsEPUB.contents.ncx) {
        config.akashacmsEPUB.manifest.push({
            id: config.akashacmsEPUB.contents.ncx.id,
            type: "application/x-dtbncx+xml",
            href: config.akashacmsEPUB.contents.ncx.href
        });
    }
    
    // logger.info('******** Chapters ');
    
    // Add chapter files to manifests
    var addChapterData = function(chapter) {
        // logger.info(util.inspect(chapter));
        config.akashacmsEPUB.manifest.push({
            id: chapter.id,
            type: chapter.type,
            href: chapter.href
        });
        config.akashacmsEPUB.opfspine.push({
            idref: chapter.id,
        });
        if (chapter.subchapters) {
            chapter.subchapters.forEach(addChapterData);
        }
    };
    config.akashacmsEPUB.chapters.forEach(addChapterData);
    
    // logger.info('******** Stylesheets ');
    // logger.info(util.inspect(config.akashacmsEPUB.stylesheets));
    
    // Add stylesheets to manifests
    config.akashacmsEPUB.stylesheets.forEach(function(cssfile) {
        config.akashacmsEPUB.manifest.push({
            id: cssfile.id,
            type: cssfile.type,
            href: cssfile.href
        });
    });
    
    // logger.info('******** Assets ');
    
    // Add asset files to manifests
    config.akashacmsEPUB.assets.forEach(function(assetfile) {
        config.akashacmsEPUB.manifest.push({
            id: assetfile.id,
            type: assetfile.type,
            href: assetfile.href
        });
    });
	
    
	// Fix up the titles to be what's in the referenced file
	// Make sure to do this before running these steps so that we know the titles are right.
	// By running those steps in parallel we aren't certain of what order anything will execute
	
	
    async.series([
        function(next) {
			// logger.info('********* mkdirs');
            fs.mkdirs(path.join(config.root_out, "META-INF"), next);
        },
        function(next) {
			// logger.info('********* mimetype');
            fs.writeFile(path.join(config.root_out, "mimetype"), "application/epub+zip", "utf8", next);
        },
        function(next) {
			// logger.info('********* container');
            akasha.partial("container.xml.ejs", config.akashacmsEPUB, function(err, html) {
                if (err) next(err);
                else {
                    fs.writeFile(path.join(config.root_out, "META-INF", "container.xml"),
                                 html, "utf8", next);
                }
            });
        },
        function(next) {
            // logger.info('********* COVER');
            akasha.partial("cover.html.ejs", {
                src: config.akashacmsEPUB.cover.src,
                alt: config.akashacmsEPUB.cover.alt,
                idImage: config.akashacmsEPUB.cover.idImage
            }, function(err, html) {
                if (err) next(err);
                else fs.writeFile(path.join(config.root_out, "cover.html"), html, "utf8", next);
            });
        },
        function(next) {
			// logger.info('********* OPF');
            akasha.partial("open-package.opf.ejs", config.akashacmsEPUB, function(err, html) {
                if (err) next(err);
                else {
                    fs.writeFile(path.join(config.root_out, config.akashacmsEPUB.files.opf),
                                 html, "utf8", next);
                }
            });
        },
        function(next) {
			// logger.info('********* NCX');
			// util.log(util.inspect(config.akashacmsEPUB.toc));
            if (config.akashacmsEPUB.contents.ncx) {
                akasha.partial("toc.ncx.ejs", config.akashacmsEPUB, function(err, html) {
                    if (err) next(err);
                    else {
                        fs.writeFile(path.join(config.root_out, config.akashacmsEPUB.contents.ncx.href),
                                 html, "utf8", next);
                    }
                });
            } else next();
    
        },
        function(next) {
			// logger.info('********* TOC');
            // util.log(util.inspect(item));
            // logger.info(util.inspect(config.akashacmsEPUB.manifest));
            akasha.partial("toc-epub3.html.ejs", {
                pageLayout: config.akashacmsEPUB.contents.toclayout,
                title: config.akashacmsEPUB.contents.title,
                subTitle: config.akashacmsEPUB.contents.subtitle,
                id: config.akashacmsEPUB.contents.id,
                chapters: config.akashacmsEPUB.chapters,
                navtype: "toc",
                toctype: config.akashacmsEPUB.contents.toctype,
                tocstart: config.akashacmsEPUB.contents.tocstart
            },
            function(err, html) {
                if (err) next(err);
                else {
                    html = '---\n'
                         + 'layout: '+ config.akashacmsEPUB.contents.toclayout +'\n'
                         + 'title: '+ config.akashacmsEPUB.contents.title +'\n'
                         + '---\n'
                         + html;
                    // util.log(html);
                    akasha.createInMemoryDocument(config, config.root_docs[0],
                                                  config.akashacmsEPUB.contents.path, html, function(err, entry) {
                        if (err) next(err);
                        else {
                            // util.log(util.inspect(entry));
                            akasha.renderDocument(config, entry, function(err) {
                                if (err) next(err);
                                else next();
                            });
                        }
                    });
                }
            });
        }
    ],
    function(err, results) {
        if (err) done(err);
        else done();
    });
};

module.exports.bundleEPUB = function(epubversion, done) {
    
    var epubconfig = config.akashacmsEPUB;
    
    var archive = archiver('zip');
    
    var output = fs.createWriteStream(config.akashacmsEPUB.files.epub);
            
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
    
    archive.append(
        fs.createReadStream(path.join(config.root_out, "mimetype")),
        { name: "mimetype", store: true });
    archive.append(
        fs.createReadStream(path.join(config.root_out, "META-INF", "container.xml")),
        { name: path.join("META-INF", "container.xml") });
    archive.append(
        fs.createReadStream(path.join(config.root_out, config.akashacmsEPUB.files.opf)),
        { name: config.akashacmsEPUB.files.opf });
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
            logger.info('before finalize');
            archive.finalize();
        });
};

module.exports.titleForManifestItem = function(item) {
	var itemEntry = akasha.findDocumentForUrlpath(config, item.href);
	if (itemEntry && itemEntry.frontmatter.yaml.title)
		return itemEntry.frontmatter.yaml.title;
	else if (itemEntry && itemEntry.frontmatter.yaml.pagetitle)
		return itemEntry.frontmatter.yaml.pagetitle;
	else 
		return item.title;
};

module.exports.findManifestItem = function(id) {
    
    var epubconfig = config.akashacmsEPUB;
    
    var found;
	// util.log('findManifestItem '+ util.inspect(epubconfig.manifest));
	for (var itemkey in epubconfig.manifest) {
		var item = epubconfig.manifest[itemkey];
        // if (!found) util.log('findManifestItem id='+ id +' item.id='+ item.id);
        if (!found && item.id === id) {
            // util.log('findManifestItem id='+ id +' '+ util.inspect(item));
            found = item;
        }
    }
    return found;
};

// Special renderChain's just for generating EPUB's.

var rendererXmlEjs = {
  match: function(fname) {
	var matches;
	if ((matches = fname.match(/^(.*\.xml)(\.ejs)$/)) !== null) {
	  return {
		path: matches[0],
		renderedFileName: matches[1],
		extension: matches[2]
	  };
	} else {
	  return null;
	}
  },
  renderSync: function(text, metadata) {
	return ejs.render(text, metadata);
  },
  render: function(text, metadata, done) {
	done(null, ejs.render(text, metadata));
  }
};

var rendererOpfEjs = {
  match: function(fname) {
	var matches;
	if ((matches = fname.match(/^(.*\.opf)(\.ejs)$/)) !== null) {
	  return {
		path: matches[0],
		renderedFileName: matches[1],
		extension: matches[2]
	  };
	} else {
	  return null;
	}
  },
  renderSync: function(text, metadata) {
	return ejs.render(text, metadata);
  },
  render: function(text, metadata, done) {
	done(null, ejs.render(text, metadata));
  }
};

var rendererNcxEjs = {
  match: function(fname) {
	var matches;
	if ((matches = fname.match(/^(.*\.ncx)(\.ejs)$/)) !== null) {
	  return {
		path: matches[0],
		renderedFileName: matches[1],
		extension: matches[2]
	  };
	} else {
	  return null;
	}
  },
  renderSync: function(text, metadata) {
	return ejs.render(text, metadata);
  },
  render: function(text, metadata, done) {
	done(null, ejs.render(text, metadata));
  }
};

var rendererEpubContainer = {
    match: function(fname) {
        var matches;
        if ((matches = fname.match(/^(.*\.xml)(\.epubcontainer)$/)) !== null) {
            return {
                path: matches[0],
                renderedFileName: matches[1],
                extension: matches[2]
            };
        } else {
            return null;
        }
    },
    renderSync: function(text, metadata) {
        return akasha.partialSync("container.xml.ejs", metadata);
    },
    render: function(text, metadata, done) {
        akasha.partial("container.xml.ejs", metadata, done);
    }
};
