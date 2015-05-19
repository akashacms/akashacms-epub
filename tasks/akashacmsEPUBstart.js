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

var fs   = require('fs');
var path = require('path');
var util = require('util');

module.exports = function(grunt) {
    grunt.registerTask('akashacmsEPUBstart', function() {
        var done = this.async();
        
        var config;
        
        if (!grunt.config("config")) {
            // Default config object based on information from the Grunt config
            /* grunt.config.requires('root_assets');
            grunt.config.requires('root_layouts');
            grunt.config.requires('root_partials');
            grunt.config.requires('root_out');
            grunt.config.requires('root_docs');
            grunt.config.requires('headerScripts'); */
            
            config = {
            
                root_assets: grunt.config('root_assets'),
                root_layouts: grunt.config('root_layouts'),
                root_partials: grunt.config('root_partials'),
                root_out: grunt.config('root_out'),
                root_docs: grunt.config('root_docs'),
                
                headerScripts: grunt.config('headerScripts'),
                cheerio: {
                    recognizeSelfClosing: true,
                    recognizeCDATA: true,
                    xmlMode: true
                },
                config: function(akasha) {
            		akasha.registerPlugins([
                        { name: 'akashacms-epub', plugin: grunt.config('akashaEPUB') }
            		]);
                }
            };
            
            var stat;
            if (!config.root_assets) {
                config.root_assets = [];
                if (fs.existsSync('assets') && (stat = fs.statSync('assets'))) {
                    if (stat.isDirectory()) {
                        config.root_assets = [ 'assets' ];
                    }
                }
            }
            if (!config.root_layouts) {
                config.root_layouts = [];
                if (fs.existsSync('layouts') && (stat = fs.statSync('layouts'))) {
                    if (stat.isDirectory()) {
                        config.root_layouts = [ 'layouts' ];
                    }
                }
            }
            if (!config.root_partials) {
                config.root_partials = [];
                if (fs.existsSync('partials') && (stat = fs.statSync('partials'))) {
                    if (stat.isDirectory()) {
                        config.root_partials = [ 'partials' ];
                    }
                }
            }
            if (!config.root_out) {
                config.root_out = [];
                if (fs.existsSync('out') && (stat = fs.statSync('out'))) {
                    if (stat.isDirectory()) {
                        config.root_out = [ 'out' ];
                    }
                }
            }
            if (!config.root_docs) {
                config.root_docs = [];
                if (fs.existsSync('documents') && (stat = fs.statSync('documents'))) {
                    if (stat.isDirectory()) {
                        config.root_docs = [ 'documents' ];
                    }
                }
            }
        } else {
            config = grunt.config("config");
        }
        
        akasha.config(config);
        grunt.config('config', config);
        
        done();
    });
};
