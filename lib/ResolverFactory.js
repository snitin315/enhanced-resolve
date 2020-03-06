/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const Resolver = require("./Resolver");
const { getType, PathType } = require("./pathUtils");

const SyncAsyncFileSystemDecorator = require("./SyncAsyncFileSystemDecorator");

const AliasFieldPlugin = require("./AliasFieldPlugin");
const AliasPlugin = require("./AliasPlugin");
const AppendPlugin = require("./AppendPlugin");
const DescriptionFilePlugin = require("./DescriptionFilePlugin");
const DirectoryExistsPlugin = require("./DirectoryExistsPlugin");
const FileExistsPlugin = require("./FileExistsPlugin");
const FileKindPlugin = require("./FileKindPlugin");
const JoinRequestPartPlugin = require("./JoinRequestPartPlugin");
const JoinRequestPlugin = require("./JoinRequestPlugin");
const MainFieldPlugin = require("./MainFieldPlugin");
const ModuleKindPlugin = require("./ModuleKindPlugin");
const ModulesInHierachicDirectoriesPlugin = require("./ModulesInHierachicDirectoriesPlugin");
const ModulesInRootPlugin = require("./ModulesInRootPlugin");
const NextPlugin = require("./NextPlugin");
const ParsePlugin = require("./ParsePlugin");
const PnpPlugin = require("./PnpPlugin");
const ResultPlugin = require("./ResultPlugin");
const SymlinkPlugin = require("./SymlinkPlugin");
const TryNextPlugin = require("./TryNextPlugin");
const UnsafeCachePlugin = require("./UnsafeCachePlugin");
const UseFilePlugin = require("./UseFilePlugin");

/** @typedef {import("./PnpPlugin").PnpApiImpl} PnpApi */

/** @typedef {string|Array<string>|false} AliasOptionNewRequest */
/** @typedef {{alias: AliasOptionNewRequest, name: string, onlyModule?: boolean}} AliasOptionEntry */
/** @typedef {{[k: string]: AliasOptionNewRequest}} AliasOptions */

/**
 * @typedef {Object} ResolveOptions
 * @property {(AliasOptions | Array<AliasOptionEntry>)=} alias
 * @property {(Array<string | Array<string>>)=} aliasFields
 * @property {(function({path: string, request: string}): boolean)=} cachePredicate
 * @property {boolean=} cacheWithContext
 * @property {Array<string>=} descriptionFiles
 * @property {boolean=} enforceExtension
 * @property {(Array<string> | string)=} extensions
 * @property {Object=} fileSystem
 * @property {(Object | boolean)=} unsafeCache
 * @property {boolean=} symlinks
 * @property {Resolver=} resolver
 * @property {(Array<string> | string)=} modules
 * @property {Array<string | Array<string>>=} mainFields
 * @property {Array<string>=} mainFiles
 * @property {Array<{apply: function(Resolver): void}>=} plugins
 * @property {PnpApi=} pnpApi
 * @property {boolean=} resolveToContext
 * @property {boolean=} useSyncFileSystemCalls
 */

/**
 * @param {PnpApi=} option option
 * @returns {PnpApi | null} processed option
 */
function processPnpApiOption(option) {
	if (
		option === undefined &&
		/** @type {NodeJS.ProcessVersions & {pnp: string}} */ (process.versions).pnp
	) {
		// @ts-ignore
		return require("pnpapi"); // eslint-disable-line node/no-missing-require
	}

	return option || null;
}

/**
 * @param {ResolveOptions} options resolve options
 * @returns {Resolver} created resolver
 */
exports.createResolver = function(options) {
	//// OPTIONS ////

	// A list of description files to read from
	const descriptionFiles = options.descriptionFiles || ["package.json"];

	// A list of additional resolve plugins which should be applied
	// The slice is there to create a copy, because otherwise pushing into plugins
	// changes the original options.plugins array, causing duplicate plugins
	const plugins = (options.plugins && options.plugins.slice()) || [];

	// A list of alias fields in description files
	const aliasFields = options.aliasFields || [];

	// A list of main files in directories
	const mainFiles = options.mainFiles || ["index"];

	// A list of extensions which should be tried for files
	const extensions = options.extensions
		? /** @type {Array<string>} */ ([]).concat(options.extensions)
		: [".js", ".json", ".node"];

	// Enforce that a extension from extensions must be used
	const enforceExtension = options.enforceExtension || false;

	/**
	 * A list of module alias configurations or an object which maps key to value
	 * @type {Array<AliasOptionEntry>}
	 */
	const alias =
		typeof options.alias === "object" &&
		!Array.isArray(options.alias) &&
		options.alias !== null
			? aliasOptionsToArray(options.alias)
			: /** @type {Array<AliasOptionEntry>} */ (options.alias) || [];

	// A PnP API that should be used - null is "never", undefined is "auto"
	const pnpApi = processPnpApiOption(options.pnpApi);

	// Resolve symlinks to their symlinked location
	const symlinks =
		typeof options.symlinks !== "undefined" ? options.symlinks : true;

	// Resolve to a context instead of a file
	const resolveToContext = options.resolveToContext || false;

	// Use this cache object to unsafely cache the successful requests
	const unsafeCache =
		options.unsafeCache && typeof options.unsafeCache !== "object"
			? {}
			: options.unsafeCache || false;

	// Whether or not the unsafeCache should include request context as part of the cache key.
	const cacheWithContext =
		typeof options.cacheWithContext !== "undefined"
			? options.cacheWithContext
			: true;

	// A function which decides whether a request should be cached or not.
	// an object is passed with `path` and `request` properties.
	const cachePredicate =
		options.cachePredicate ||
		function() {
			return true;
		};

	// The file system which should be used
	const fileSystem = options.fileSystem;

	// Use only the sync constiants of the file system calls
	const useSyncFileSystemCalls = options.useSyncFileSystemCalls;

	// A prepared Resolver to which the plugins are attached
	const resolver = options.resolver
		? options.resolver
		: new Resolver(
				useSyncFileSystemCalls
					? new SyncAsyncFileSystemDecorator(fileSystem)
					: fileSystem
		  );

	/**
	 * A list of directories to resolve modules from, can be absolute path or folder name
	 * @type {Array<string|Array<string>>}
	 */
	const modules = mergeFilteredToArray(
		options.modules
			? /** @type {Array<string>} */ ([]).concat(options.modules)
			: ["node_modules"],
		item => {
			const type = getType(item);
			return type === PathType.Normal || type === PathType.Relative;
		}
	);

	/**
	 * A list of main fields in description files
	 * @type {Array<{name: string|Array<string>, forceRelative: boolean}>}
	 */
	const mainFields = (options.mainFields || ["main"]).map(item => {
		if (typeof item === "string" || Array.isArray(item)) {
			return {
				name: item,
				forceRelative: true
			};
		}
		return item;
	});

	//// pipeline ////

	resolver.ensureHook("resolve");
	resolver.ensureHook("parsedResolve");
	resolver.ensureHook("describedResolve");
	resolver.ensureHook("rawModule");
	resolver.ensureHook("module");
	resolver.ensureHook("resolveInDirectory");
	resolver.ensureHook("resolveInExistingDirectory");
	resolver.ensureHook("relative");
	resolver.ensureHook("describedRelative");
	resolver.ensureHook("directory");
	resolver.ensureHook("undescribedExistingDirectory");
	resolver.ensureHook("existingDirectory");
	resolver.ensureHook("undescribedRawFile");
	resolver.ensureHook("rawFile");
	resolver.ensureHook("file");
	resolver.ensureHook("existingFile");
	resolver.ensureHook("resolved");

	// resolve
	if (unsafeCache) {
		plugins.push(
			new UnsafeCachePlugin(
				"resolve",
				cachePredicate,
				unsafeCache,
				cacheWithContext,
				"new-resolve"
			)
		);
		plugins.push(new ParsePlugin("new-resolve", "parsed-resolve"));
	} else {
		plugins.push(new ParsePlugin("resolve", "parsed-resolve"));
	}

	// parsed-resolve
	plugins.push(
		new DescriptionFilePlugin(
			"parsed-resolve",
			descriptionFiles,
			false,
			"described-resolve"
		)
	);
	plugins.push(new NextPlugin("after-parsed-resolve", "described-resolve"));

	// described-resolve
	if (alias.length > 0)
		plugins.push(new AliasPlugin("described-resolve", alias, "resolve"));
	aliasFields.forEach(item => {
		plugins.push(new AliasFieldPlugin("described-resolve", item, "resolve"));
	});
	plugins.push(new ModuleKindPlugin("after-described-resolve", "raw-module"));
	plugins.push(new JoinRequestPlugin("after-described-resolve", "relative"));

	// module
	if (pnpApi) {
		plugins.push(new PnpPlugin("raw-module", pnpApi, "relative"));
	}
	modules.forEach(item => {
		if (Array.isArray(item))
			plugins.push(
				new ModulesInHierachicDirectoriesPlugin("raw-module", item, "module")
			);
		else plugins.push(new ModulesInRootPlugin("raw-module", item, "module"));
	});

	// module
	plugins.push(new JoinRequestPartPlugin("module", "resolve-in-directory"));

	// resolve-in-directory
	if (!resolveToContext) {
		plugins.push(
			new FileKindPlugin(
				"resolve-in-directory",
				"single file module",
				"undescribed-raw-file"
			)
		);
	}
	plugins.push(
		new DirectoryExistsPlugin(
			"resolve-in-directory",
			"resolve-in-existing-directory"
		)
	);

	// resolve-in-existing-directory
	plugins.push(
		new JoinRequestPlugin("resolve-in-existing-directory", "relative")
	);

	// relative
	plugins.push(
		new DescriptionFilePlugin(
			"relative",
			descriptionFiles,
			true,
			"described-relative"
		)
	);
	plugins.push(new NextPlugin("after-relative", "described-relative"));

	// described-relative
	if (!resolveToContext) {
		plugins.push(new FileKindPlugin("described-relative", null, "raw-file"));
	}
	plugins.push(
		new TryNextPlugin("described-relative", "as directory", "directory")
	);

	// directory
	plugins.push(
		new DirectoryExistsPlugin("directory", "undescribed-existing-directory")
	);

	if (resolveToContext) {
		// undescribed-existing-directory
		plugins.push(new NextPlugin("undescribed-existing-directory", "resolved"));
	} else {
		// undescribed-existing-directory
		plugins.push(
			new DescriptionFilePlugin(
				"undescribed-existing-directory",
				descriptionFiles,
				false,
				"existing-directory"
			)
		);
		mainFiles.forEach(item => {
			plugins.push(
				new UseFilePlugin(
					"undescribed-existing-directory",
					item,
					"undescribed-raw-file"
				)
			);
		});

		// described-existing-directory
		mainFields.forEach(item => {
			plugins.push(
				new MainFieldPlugin(
					"existing-directory",
					item,
					"resolve-in-existing-directory"
				)
			);
		});
		mainFiles.forEach(item => {
			plugins.push(
				new UseFilePlugin("existing-directory", item, "undescribed-raw-file")
			);
		});

		// undescribed-raw-file
		plugins.push(
			new DescriptionFilePlugin(
				"undescribed-raw-file",
				descriptionFiles,
				true,
				"raw-file"
			)
		);
		plugins.push(new NextPlugin("after-undescribed-raw-file", "raw-file"));

		// raw-file
		if (!enforceExtension) {
			plugins.push(new TryNextPlugin("raw-file", "no extension", "file"));
		}
		extensions.forEach(item => {
			plugins.push(new AppendPlugin("raw-file", item, "file"));
		});

		// file
		if (alias.length > 0)
			plugins.push(new AliasPlugin("file", alias, "resolve"));
		aliasFields.forEach(item => {
			plugins.push(new AliasFieldPlugin("file", item, "resolve"));
		});
		plugins.push(new FileExistsPlugin("file", "existing-file"));

		// existing-file
		if (symlinks)
			plugins.push(new SymlinkPlugin("existing-file", "existing-file"));
		plugins.push(new NextPlugin("existing-file", "resolved"));
	}

	// resolved
	plugins.push(new ResultPlugin(resolver.hooks.resolved));

	//// RESOLVER ////

	plugins.forEach(plugin => {
		plugin.apply(resolver);
	});

	return resolver;
};

/**
 * @param {AliasOptions} alias alias
 * @returns {Array<AliasOptionEntry>} array of entries
 */
function aliasOptionsToArray(alias) {
	return Object.keys(alias).map(key => {
		/** @type {AliasOptionEntry} */
		const obj = { name: key, onlyModule: false, alias: alias[key] };

		if (/\$$/.test(key)) {
			obj.onlyModule = true;
			obj.name = key.substr(0, key.length - 1);
		}

		return obj;
	});
}

/**
 * Merging filtered elements
 * @param {Array<string>} array source array
 * @param {function(string): boolean} filter predicate
 * @returns {Array<string | Array<string>>} merge result
 */
function mergeFilteredToArray(array, filter) {
	return array.reduce((
		/** @type {Array<string | Array<string>>} */ array,
		item
	) => {
		if (filter(item)) {
			const lastElement =
				/** @type {Array<string>} */ (array[array.length - 1]);
			if (Array.isArray(lastElement)) {
				lastElement.push(item);
			} else {
				array.push([item]);
			}
		} else {
			array.push(item);
		}

		return array;
	}, []);
}
