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
    
    [ rendererEpubContainer, rendererXmlEjs, rendererOpfEjs ].forEach(function(renderer) {
		akasha.registerRenderChain(renderer);
	});
    
    akasha.emitter.on('done-render-files', function(cb) {
        logger.info('done-render-files received');
        
        var epubconfig = config.akashacmsEPUB;
        
        if (!epubconfig.files2generate.opf) throw new Error('no OPF file specified');
        if (!epubconfig.rootfiles) {
            epubconfig.rootfiles = [ ];
        }
        epubconfig.rootfiles.push({
            path: path.join("..", epubconfig.files2generate.opf),
            type: "application/oebps-package+xml"
        });
        
        fs.writeFileSync(path.join(config.root_out, "mimetype"), "application/epub+zip\n", "utf8");
        
        fs.mkdirsSync(path.join(config.root_out, "META-INF"));
        fs.writeFileSync(path.join(config.root_out, "META-INF", "container.xml"),
                         akasha.partialSync("container.xml.ejs", epubconfig), "utf8");
        
        fs.writeFileSync(path.join(config.root_out, epubconfig.files2generate.opf),
                         akasha.partialSync("open-package.opf.ejs", epubconfig), "utf8");
        
        // fs.rmdirSync(tempDir.path);
        cb();
    });
    
	return module.exports;
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
