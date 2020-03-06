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
/** @typedef {import("./Resolver").FileSystem} FileSystem */
/** @typedef {import("./Resolver").ResolveRequest} ResolveRequest */

/** @typedef {string|string[]|false} AliasOptionNewRequest */
/** @typedef {{alias: AliasOptionNewRequest, name: string, onlyModule?: boolean}} AliasOptionEntry */
/** @typedef {{[k: string]: AliasOptionNewRequest}} AliasOptions */
/** @typedef {{apply: function(Resolver): void} | function(Resolver): void} Plugin */

/**
 * @typedef {Object} UserResolveOptions
 * @property {(AliasOptions | AliasOptionEntry[])=} alias A list of module alias configurations or an object which maps key to value
 * @property {(string | string[])[]=} aliasFields A list of alias fields in description files
 * @property {(function(ResolveRequest): boolean)=} cachePredicate A function which decides whether a request should be cached or not. An object is passed with at least `path` and `request` properties.
 * @property {boolean=} cacheWithContext Whether or not the unsafeCache should include request context as part of the cache key.
 * @property {string[]=} descriptionFiles A list of description files to read from
 * @property {boolean=} enforceExtension Enforce that a extension from extensions must be used
 * @property {string[]=} extensions A list of extensions which should be tried for files
 * @property {FileSystem} fileSystem The file system which should be used
 * @property {(Object | boolean)=} unsafeCache Use this cache object to unsafely cache the successful requests
 * @property {boolean=} symlinks Resolve symlinks to their symlinked location
 * @property {Resolver=} resolver A prepared Resolver to which the plugins are attached
 * @property {string[] | string=} modules A list of directories to resolve modules from, can be absolute path or folder name
 * @property {(string | string[] | {name: string | string[], forceRelative: boolean})[]=} mainFields A list of main fields in description files
 * @property {string[]=} mainFiles  A list of main files in directories
 * @property {Plugin[]=} plugins A list of additional resolve plugins which should be applied
 * @property {PnpApi | null=} pnpApi A PnP API that should be used - null is "never", undefined is "auto"
 * @property {boolean=} resolveToContext Resolve to a context instead of a file
 * @property {boolean=} useSyncFileSystemCalls Use only the sync constiants of the file system calls
 */

/**
 * @typedef {Object} ResolveOptions
 * @property {AliasOptionEntry[]} alias
 * @property {string[][]} aliasFields
 * @property {(function(ResolveRequest): boolean)} cachePredicate
 * @property {boolean} cacheWithContext
 * @property {string[]} descriptionFiles
 * @property {boolean} enforceExtension
 * @property {string[]} extensions
 * @property {FileSystem} fileSystem
 * @property {Object | false} unsafeCache
 * @property {boolean} symlinks
 * @property {Resolver=} resolver
 * @property {(string | string[])[]} modules
 * @property {{name: string[], forceRelative: boolean}[]} mainFields
 * @property {string[]} mainFiles
 * @property {Plugin[]} plugins
 * @property {PnpApi | null} pnpApi
 * @property {boolean} resolveToContext
 */

/**
 * @param {PnpApi | null=} option option
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
 * @param {UserResolveOptions} options input options
 * @returns {ResolveOptions} output options
 */
function createOptions(options) {
	return {
		alias:
			typeof options.alias === "object" &&
			!Array.isArray(options.alias) &&
			options.alias !== null
				? aliasOptionsToArray(options.alias)
				: /** @type {Array<AliasOptionEntry>} */ (options.alias) || [],
		aliasFields: (options.aliasFields || []).map(item =>
			Array.isArray(item) ? item : [item]
		),
		cachePredicate:
			options.cachePredicate ||
			function() {
				return true;
			},
		cacheWithContext:
			typeof options.cacheWithContext !== "undefined"
				? options.cacheWithContext
				: true,
		descriptionFiles: options.descriptionFiles || ["package.json"],
		enforceExtension: options.enforceExtension || false,
		extensions: options.extensions
			? /** @type {string[]} */ ([]).concat(options.extensions)
			: [".js", ".json", ".node"],
		fileSystem: options.useSyncFileSystemCalls
			? new SyncAsyncFileSystemDecorator(options.fileSystem)
			: options.fileSystem,
		unsafeCache:
			options.unsafeCache && typeof options.unsafeCache !== "object"
				? {}
				: options.unsafeCache || false,
		symlinks: typeof options.symlinks !== "undefined" ? options.symlinks : true,
		resolver: options.resolver,
		modules: mergeFilteredToArray(
			Array.isArray(options.modules)
				? options.modules
				: options.modules
				? [options.modules]
				: ["node_modules"],
			item => {
				const type = getType(item);
				return type === PathType.Normal || type === PathType.Relative;
			}
		),
		mainFields: (options.mainFields || ["main"]).map(item => {
			if (typeof item === "string") {
				return {
					name: [item],
					forceRelative: true
				};
			}
			if (Array.isArray(item)) {
				return {
					name: item,
					forceRelative: true
				};
			}
			return {
				name: Array.isArray(item.name) ? item.name : [item.name],
				forceRelative: item.forceRelative
			};
		}),
		mainFiles: options.mainFiles || ["index"],
		plugins: options.plugins || [],
		pnpApi: processPnpApiOption(options.pnpApi),
		resolveToContext: options.resolveToContext || false
	};
}

/**
 * @param {UserResolveOptions} options resolve options
 * @returns {Resolver} created resolver
 */
exports.createResolver = function(options) {
	const normalizedOptions = createOptions(options);

	const {
		alias,
		aliasFields,
		cachePredicate,
		cacheWithContext,
		descriptionFiles,
		enforceExtension,
		extensions,
		fileSystem,
		mainFields,
		mainFiles,
		modules,
		plugins: userPlugins,
		pnpApi,
		resolveToContext,
		symlinks,
		unsafeCache,
		resolver: customResolver
	} = normalizedOptions;

	const plugins = userPlugins.slice();

	const resolver = customResolver
		? customResolver
		: new Resolver(fileSystem, normalizedOptions);

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

	for (const plugin of plugins) {
		if (typeof plugin === "function") {
			plugin.call(resolver, resolver);
		} else {
			plugin.apply(resolver);
		}
	}

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
 * @param {string[]} array source array
 * @param {function(string): boolean} filter predicate
 * @returns {Array<string | string[]>} merge result
 */
function mergeFilteredToArray(array, filter) {
	return array.reduce((/** @type {Array<string | string[]>} */ array, item) => {
		if (filter(item)) {
			const lastElement = /** @type {string[]} */ (array[array.length - 1]);
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
