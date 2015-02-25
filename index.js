/**
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

var path     = require('path');
var util     = require('util');
var url      = require('url');
var async    = require('async');
var ejs      = require('ejs');
var fs       = require('fs-extra');
var archiver = require('archiver');

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
    
    if (!config.akashacmsEPUB.files2generate) config.akashacmsEPUB.files2generate = {};
    if (!config.akashacmsEPUB.metadata) config.akashacmsEPUB.metadata = {};
    if (!config.akashacmsEPUB.manifest) config.akashacmsEPUB.manifest = {};
    
    [ rendererEpubContainer, rendererXmlEjs, rendererOpfEjs, rendererNcxEjs ].forEach(function(renderer) {
		akasha.registerRenderChain(renderer);
	});
    
	return module.exports;
};

module.exports.getEPUBmetadata = function(done) {
    return config.akashacmsEPUB;
};

module.exports.generateEPUBFiles = function(akasha, config, done) {
    var epubconfig = config.akashacmsEPUB;
    
    if (!epubconfig.files2generate.opf) throw new Error('no OPF file specified');
    if (!epubconfig.rootfiles) {
        epubconfig.rootfiles = [ ];
    }
    epubconfig.rootfiles.push({
        path: epubconfig.files2generate.opf,
        type: "application/oebps-package+xml"
    });
    
    async.parallel([
        function(next) {
            fs.mkdirs(path.join(config.root_out, "META-INF"), next);
        },
        function(next) {
            fs.writeFile(path.join(config.root_out, "mimetype"), "application/epub+zip", "utf8", next);
        },
        function(next) {
            akasha.partial("container.xml.ejs", epubconfig, function(err, html) {
                if (err) next(err);
                else {
                    fs.writeFile(path.join(config.root_out, "META-INF", "container.xml"),
                                 html, "utf8", next);
                }
            });
        },
        function(next) {
            akasha.partial("open-package.opf.ejs", epubconfig, function(err, html) {
                if (err) next(err);
                else {
                    fs.writeFile(path.join(config.root_out, epubconfig.files2generate.opf),
                                 html, "utf8", next);
                }
            });
        },
        function(next) {
            akasha.partial("toc.ncx.ejs", epubconfig, function(err, html) {
                if (err) next(err);
                else {
                    fs.writeFile(path.join(config.root_out, epubconfig.files2generate.ncx),
                             html, "utf8", next);
                }
            });
    
        },
        function(next) {
            var item = module.exports.findManifestItem(epubconfig.files2generate.toc);
            // util.log(util.inspect(item));
            akasha.partial("toc-epub3.html.ejs", {
                pageLayout: item.toclayout,
                title: epubconfig.metadata.title,
                subTitle: item.title,
                id: epubconfig.files2generate.toc,
                toc: epubconfig.toc
            },
            function(err, html) {
                if (err) next(err);
                else {
                    html = '---\n'
                         + 'layout: '+ item.toclayout +'\n'
                         + 'title: '+ epubconfig.metadata.title +'\n'
                         + '---\n'
                         + html;
                    // util.log(html);
                    akasha.createInMemoryDocument(config, config.root_docs[0],
                                                  item.path, html, function(err, entry) {
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

module.exports.bundleEPUB = function(config, epubversion, done) {
    
    var epubconfig = config.akashacmsEPUB;
    
    var archive = archiver('zip');
    
    var output = fs.createWriteStream(epubconfig.files2generate.epub);
            
    output.on('close', function() {
        logger.info(archive.pointer() + ' total bytes');
        logger.info('archiver has been finalized and the output file descriptor has closed.');  
        done();
    });
    
    archive.on('error', function(err) {
      done(err);
    });
    
    archive.pipe(output);
    
    archive.append(
        fs.createReadStream(path.join(config.root_out, "mimetype")),
        { name: "mimetype" });
    archive.append(
        fs.createReadStream(path.join(config.root_out, "META-INF", "container.xml")),
        { name: path.join("META-INF", "container.xml") });
    archive.append(
        fs.createReadStream(path.join(config.root_out, epubconfig.files2generate.opf)),
        { name: epubconfig.files2generate.opf });
    archive.append(
        fs.createReadStream(path.join(config.root_out, epubconfig.files2generate.ncx)),
        { name: epubconfig.files2generate.ncx });
    
    async.eachSeries(epubconfig.manifest,
        function(item, next) {
            if (item.spinetoc !== true) {
                archive.append(
                    fs.createReadStream(path.join(config.root_out, item.href)),
                    { name: item.href }
                );
            }
            next();
        },
        function(err) {
            archive.finalize();
        });
};

module.exports.findManifestItem = function(id) {
    
    var epubconfig = config.akashacmsEPUB;
    
    var found;
    epubconfig.manifest.forEach(function(item) {
        // if (!found) util.log('findManifestItem id='+ id +' item.id='+ item.id);
        if (!found && item.id === id) {
            // util.log('findManifestItem id='+ id +' '+ util.inspect(item));
            found = item;
        }
    });
    return found;
};

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
