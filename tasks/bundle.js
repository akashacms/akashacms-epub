
module.exports = function(grunt) {
    grunt.registerTask('bundleEPUB', function() {
        var done = this.async();
        grunt.config.requires('akasha');
        grunt.config.requires('config');
        var akasha = grunt.config('akasha');
        var config = grunt.config('config');
        var epubversion = "epub3";
        if (this.flags.epub2) epubversion = "epub2";
        else if (this.flags.epub3) epubversion = "epub3";
        akasha.plugin('akashacms-epub').bundleEPUB(config, epubversion, function(err) {
            if (err) done(err);
            else done();
        });
    });
};
