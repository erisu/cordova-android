/*
       Licensed to the Apache Software Foundation (ASF) under one
       or more contributor license agreements.  See the NOTICE file
       distributed with this work for additional information
       regarding copyright ownership.  The ASF licenses this file
       to you under the Apache License, Version 2.0 (the
       "License"); you may not use this file except in compliance
       with the License.  You may obtain a copy of the License at

         http://www.apache.org/licenses/LICENSE-2.0

       Unless required by applicable law or agreed to in writing,
       software distributed under the License is distributed on an
       "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
       KIND, either express or implied.  See the License for the
       specific language governing permissions and limitations
       under the License.
*/

var path = require('path');
var fs = require('fs-extra');
var utils = require('./utils');
var check_reqs = require('./check_reqs');
var ROOT = path.join(__dirname, '..');
const { createEditor } = require('properties-parser');

var CordovaError = require('cordova-common').CordovaError;
var AndroidManifest = require('./AndroidManifest');

// Export all helper functions, and make sure internally within this module, we
// reference these methods via the `exports` object - this helps with testing
// (since we can then mock and control behaviour of all of these functions)
exports.validateProjectName = validateProjectName;
exports.copyJsAndLibrary = copyJsAndLibrary;
exports.writeProjectProperties = writeProjectProperties;
exports.prepBuildFiles = prepBuildFiles;
exports.writeNameForAndroidStudio = writeNameForAndroidStudio;

function getFrameworkDir (projectPath, shared) {
    return shared ? path.join(ROOT, 'framework') : path.join(projectPath, 'CordovaLib');
}

function copyJsAndLibrary (projectPath, shared, targetAPI) {
    var nestedCordovaLibPath = getFrameworkDir(projectPath, false);
    var srcCordovaJsPath = path.join(ROOT, 'templates', 'app/src/main/assets/www/cordova.js');
    const platform_www = path.join(projectPath, 'platform_www');

    // Copy the cordova.js file to platforms/<platform>/platform_www/
    // The www dir is nuked on each prepare so we keep cordova.js in platform_www
    fs.ensureDirSync(platform_www);
    fs.copySync(srcCordovaJsPath, path.join(platform_www, 'cordova.js'));

    if (shared) {
        var relativeFrameworkPath = path.relative(projectPath, getFrameworkDir(projectPath, true));
        fs.symlinkSync(relativeFrameworkPath, nestedCordovaLibPath, 'dir');
    } else {
        fs.ensureDirSync(nestedCordovaLibPath);
        fs.copySync(path.join(ROOT, 'framework', 'AndroidManifest.xml'), path.join(nestedCordovaLibPath, 'AndroidManifest.xml'));
        const propertiesEditor = createEditor(path.join(ROOT, 'framework', 'project.properties'));
        propertiesEditor.set('target', targetAPI);
        propertiesEditor.save(path.join(nestedCordovaLibPath, 'project.properties'));
        fs.copySync(path.join(ROOT, 'framework', 'build.gradle'), path.join(nestedCordovaLibPath, 'build.gradle'));
        fs.copySync(path.join(ROOT, 'framework', 'cordova.gradle'), path.join(nestedCordovaLibPath, 'cordova.gradle'));
        fs.copySync(path.join(ROOT, 'framework', 'repositories.gradle'), path.join(nestedCordovaLibPath, 'repositories.gradle'));
        fs.copySync(path.join(ROOT, 'framework', 'src'), path.join(nestedCordovaLibPath, 'src'));
        fs.copySync(path.join(ROOT, 'framework', 'cdv-gradle-config-defaults.json'), path.join(projectPath, 'cdv-gradle-config.json'));
    }
}

function extractSubProjectPaths (data) {
    var ret = {};
    var r = /^\s*android\.library\.reference\.\d+=(.*)(?:\s|$)/mg;
    var m;
    while ((m = r.exec(data))) {
        ret[m[1]] = 1;
    }
    return Object.keys(ret);
}

function writeProjectProperties (projectPath, target_api) {
    var dstPath = path.join(projectPath, 'project.properties');
    var templatePath = path.join(ROOT, 'templates', 'project', 'project.properties');
    var srcPath = fs.existsSync(dstPath) ? dstPath : templatePath;

    var data = fs.readFileSync(srcPath, 'utf8');
    data = data.replace(/^target=.*/m, 'target=' + target_api);
    var subProjects = extractSubProjectPaths(data);
    subProjects = subProjects.filter(function (p) {
        return !(/^CordovaLib$/m.exec(p) ||
                 /[\\/]cordova-android[\\/]framework$/m.exec(p) ||
                 /^(\.\.[\\/])+framework$/m.exec(p));
    });
    subProjects.unshift('CordovaLib');
    data = data.replace(/^\s*android\.library\.reference\.\d+=.*\n/mg, '');
    if (!/\n$/.exec(data)) {
        data += '\n';
    }
    for (var i = 0; i < subProjects.length; ++i) {
        data += 'android.library.reference.' + (i + 1) + '=' + subProjects[i] + '\n';
    }
    fs.writeFileSync(dstPath, data);
}

// This makes no sense, what if you're building with a different build system?
function prepBuildFiles (projectPath) {
    var buildModule = require('./builders/builders');
    buildModule.getBuilder(projectPath).prepBuildFiles();
}

/**
 * Test whether given string is acceptable for use as a project name
 * Returns a promise, fulfilled if the project name is acceptable; rejected
 * otherwise.
 */
function validateProjectName (project_name) {
    var msg = 'Error validating project name. ';
    // Make sure there's something there
    if (project_name === '') {
        return Promise.reject(new CordovaError(msg + 'Project name cannot be empty'));
    }

    return Promise.resolve();
}

/**
 * Write the name of the app in "platforms/android/.idea/.name" so that Android Studio can show that name in the
 * project listing. This is helpful to quickly look in the Android Studio listing if there are so many projects in
 * Android Studio.
 *
 * https://github.com/apache/cordova-android/issues/1172
 */
function writeNameForAndroidStudio (project_path, project_name) {
    const ideaPath = path.join(project_path, '.idea');
    fs.ensureDirSync(ideaPath);
    fs.writeFileSync(path.join(ideaPath, '.name'), project_name);
}

/**
 * Creates an android application with the given options.
 *
 * @param   {String}  project_path  Path to the new Cordova android project.
 * @param   {ConfigParser}  config  Instance of ConfigParser to retrieve basic
 *   project properties.
 * @param   {Object}  [options={}]  Various options
 * @param   {Boolean}  [options.link=false]  Specifies whether javascript files
 *   and CordovaLib framework will be symlinked to created application.
 * @param   {String}  [options.customTemplate]  Path to project template
 *   (override)
 * @param   {EventEmitter}  [events]  An EventEmitter instance for logging
 *   events
 *
 * @return  {Promise<String>}  Directory where application has been created
 */
exports.create = function (project_path, config, options, events) {
    options = options || {};

    // Set default values for path, package and name
    project_path = path.relative(process.cwd(), (project_path || 'CordovaExample'));
    // Check if project already exists
    if (fs.existsSync(project_path)) {
        return Promise.reject(new CordovaError('Project already exists! Delete and recreate'));
    }

    var project_name = config.name()
        ? config.name().replace(/[^\w.]/g, '_') : 'CordovaExample';

    var target_api = check_reqs.get_target(project_path);

    // Make the package conform to Java package types
    return Promise.resolve()
        .then(function () {
            return exports.validateProjectName(project_name);
        }).then(function () {
        // Log the given values for the project
            events.emit('log', 'Creating Cordova project for the Android platform:');
            events.emit('log', '\tPath: ' + project_path);
            events.emit('log', '\tName: ' + project_name);
            events.emit('log', '\tAndroid target: ' + target_api);

            events.emit('verbose', 'Copying android template project to ' + project_path);

            const platformTemplate = options.customTemplate || path.join(ROOT, 'templates');
            fs.ensureDirSync(project_path);
            fs.copySync(platformTemplate, project_path);

            // Move gitignore template name to offical (.) format
            fs.moveSync(path.join(platformTemplate, 'gitignore'), path.join(platformTemplate, '.gitignore'));

            // Manually create directories that would be empty within the template (since git doesn't track directories).
            const appPath = path.join(project_path, 'app');
            const libsDir = path.join(project_path, 'src/main/libs');
            fs.ensureDirSync(libsDir);

            // copy cordova.js, cordova.jar
            exports.copyJsAndLibrary(project_path, options.link, target_api);

            utils.replaceFileContents(path.join(appPath, 'src/main/res/values/strings.xml'), /__NAME__/, project_name);

            // Link it to local android install.
            exports.writeProjectProperties(project_path, target_api);
            exports.prepBuildFiles(project_path);
            exports.writeNameForAndroidStudio(project_path, project_name);
            events.emit('log', generateDoneMessage('create', options.link));
        }).then(() => project_path);
};

function generateDoneMessage (type, link) {
    var pkg = require('../package');
    var msg = 'Android project ' + (type === 'update' ? 'updated ' : 'created ') + 'with ' + pkg.name + '@' + pkg.version;
    if (link) {
        msg += ' and has a linked CordovaLib';
    }
    return msg;
}

// Returns a promise.
exports.update = function (projectPath, options, events) {
    var errorString =
        'An in-place platform update is not supported. \n' +
        'The `platforms` folder is always treated as a build artifact in the CLI workflow.\n' +
        'To update your platform, you have to remove, then add your android platform again.\n' +
        'Make sure you save your plugins beforehand using `cordova plugin save`, and save \n' + 'a copy of the platform first if you had manual changes in it.\n' +
        '\tcordova plugin save\n' +
        '\tcordova platform rm android\n' +
        '\tcordova platform add android\n'
        ;

    return Promise.reject(errorString);
};
