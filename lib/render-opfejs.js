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

var ejs = require('ejs');

module.exports = {
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
