/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const path = require("path");

/** @typedef {import("./Resolver")} Resolver */
/** @typedef {import("./Resolver").ResolveStepHook} ResolveStepHook */
/** @typedef {{name: string|Array<string>, forceRelative: boolean}} MainFieldOptions */

const alreadyTriedMainField = Symbol("alreadyTriedMainField");

module.exports = class MainFieldPlugin {
	/**
	 * @param {string | ResolveStepHook} source source
	 * @param {MainFieldOptions} options options
	 * @param {string | ResolveStepHook} target target
	 */
	constructor(source, options, target) {
		this.source = source;
		this.options = options;
		this.target = target;
	}

	/**
	 * @param {Resolver} resolver the resolver
	 * @returns {void}
	 */
	apply(resolver) {
		const target = resolver.ensureHook(this.target);
		resolver
			.getHook(this.source)
			.tapAsync("MainFieldPlugin", (request, resolveContext, callback) => {
				if (
					request.path !== request.descriptionFileRoot ||
					request[alreadyTriedMainField] === request.descriptionFilePath ||
					!request.descriptionFilePath
				)
					return callback();
				const content = request.descriptionFileData;
				const filename = path.basename(request.descriptionFilePath);
				let mainModule;
				const field = this.options.name;
				if (Array.isArray(field)) {
					let current = content;
					for (let j = 0; j < field.length; j++) {
						if (current === null || typeof current !== "object") {
							current = null;
							break;
						}
						current = current[field[j]];
					}
					if (typeof current === "string") {
						mainModule = current;
					}
				} else {
					if (typeof content[field] === "string") {
						mainModule = content[field];
					}
				}
				if (!mainModule || mainModule === "." || mainModule === "./") {
					return callback();
				}
				if (this.options.forceRelative && !/^\.\.?\//.test(mainModule))
					mainModule = "./" + mainModule;
				const obj = {
					...request,
					request: mainModule,
					module: false,
					directory: mainModule.endsWith("/"),
					[alreadyTriedMainField]: request.descriptionFilePath
				};
				return resolver.doResolve(
					target,
					obj,
					"use " +
						mainModule +
						" from " +
						this.options.name +
						" in " +
						filename,
					resolveContext,
					callback
				);
			});
	}
};
