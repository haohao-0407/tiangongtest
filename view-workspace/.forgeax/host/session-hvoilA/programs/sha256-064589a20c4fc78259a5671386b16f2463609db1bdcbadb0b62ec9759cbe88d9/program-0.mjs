import "file:///D:/tiangongtest/view-workspace/.forgeax/host/session-hvoilA/programs/sha256-064589a20c4fc78259a5671386b16f2463609db1bdcbadb0b62ec9759cbe88d9/rolldown-runtime-CPxUEhZH.mjs";
import { createRequire } from "node:module";
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { defineTool, toolJsonSchema } from "file:///D:/tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+engine@0.4.19_3170f4f04506deb12fbcd2305b91656c/node_modules/@forgeax/engine/node_modules/@forgeax/engine-tool-runtime/dist/index.mjs";
import { inspectPluginFiber, registerTools, startNativePlugin } from "file:///D:/tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+engine@0.4.19_3170f4f04506deb12fbcd2305b91656c/node_modules/@forgeax/engine/node_modules/@forgeax/engine-plugin/dist/index.mjs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { attachHostWebSocketServer } from "file:///D:/tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+engine@0.4.19_3170f4f04506deb12fbcd2305b91656c/node_modules/@forgeax/engine/dist/facades/host/transport.mjs";
import { WebSocketServer } from "file:///D:/tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/ws@8.22.0/node_modules/ws/wrapper.mjs";
import { createHostAssembly } from "file:///D:/tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+engine@0.4.19_3170f4f04506deb12fbcd2305b91656c/node_modules/@forgeax/engine/dist/facades/host/protocol.mjs";
import { listPackSources } from "file:///D:/tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+engine@0.4.19_3170f4f04506deb12fbcd2305b91656c/node_modules/@forgeax/engine/dist/facades/pack/build.mjs";
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-L3BCBLSZ.mjs
var viewStartFrontendConfigSchema = {
	type: "object",
	properties: { layout: {
		type: "object",
		properties: { responsiveAutoTuck: { type: "boolean" } },
		additionalProperties: false
	} },
	additionalProperties: false
};
var properties = {
	root: { type: "string" },
	project: {
		type: "string",
		description: "Project to open when the returned URL is visited; defaults to the backend root when it contains forge.json."
	},
	frontendConfig: viewStartFrontendConfigSchema
};
var ownerProperties = { root: { type: "string" } };
JSON.stringify({
	type: "object",
	properties,
	additionalProperties: false
}), JSON.stringify({
	type: "object",
	properties: ownerProperties,
	additionalProperties: false
}), JSON.stringify({
	type: "object",
	properties: ownerProperties,
	additionalProperties: false
}), JSON.stringify({
	type: "object",
	properties: {
		root: { type: "string" },
		project: { type: "string" }
	},
	additionalProperties: false
}), JSON.stringify({
	type: "object",
	properties: {
		root: { type: "string" },
		operation: { type: "string" },
		args: { type: "object" }
	},
	required: ["operation"],
	additionalProperties: false
});
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-YCMZAYBM.mjs
var projectPath = (value) => {
	const absolute = resolve(value);
	return existsSync(absolute) ? realpathSync.native(absolute) : absolute;
};
function resolveProjectIntent(argv = [], backendRoot) {
	const index = argv.indexOf("--project");
	if (index < 0) return backendRoot && existsSync(resolve(backendRoot, "forge.json")) ? projectPath(backendRoot) : void 0;
	const value = argv[index + 1];
	if (!value?.trim() || value.startsWith("--")) throw new TypeError("--project requires a project directory");
	return projectPath(value);
}
function withProjectIntent(status, project) {
	if (!project || !status || typeof status !== "object" || !("url" in status) || typeof status.url !== "string" || !status.url) return status;
	const url = new URL(status.url);
	url.searchParams.set("project", project);
	return {
		...status,
		url: url.href
	};
}
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-4XEXLHX4.mjs
var sequence = 0;
function createWorkspaceId(prefix = "workspace") {
	const crypto = globalThis.crypto;
	if (typeof crypto?.randomUUID === "function") return `${prefix}:${crypto.randomUUID()}`;
	if (typeof crypto?.getRandomValues === "function") {
		const values = /* @__PURE__ */ new Uint32Array(4);
		crypto.getRandomValues(values);
		return `${prefix}:${Array.from(values, (value) => value.toString(16).padStart(8, "0")).join("")}`;
	}
	sequence = sequence + 1 >>> 0;
	return `${prefix}:${Date.now().toString(36)}-${sequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
}
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-2UZCN6IA.mjs
function serializeWorkspaceSceneSelection(sceneSelection) {
	if (!sceneSelection?.primary) return null;
	const entityId = requireWorkspaceString(sceneSelection.primary.entityId, "sceneSelection.primary.entityId");
	return {
		...sceneSelection.targetId === void 0 ? {} : {
			targetId: sceneSelection.targetId,
			targetGeneration: sceneSelection.targetGeneration
		},
		primary: {
			entityId,
			...sceneSelection.primary.label === void 0 ? {} : { label: String(sceneSelection.primary.label) }
		},
		...sceneSelection.entityIds === void 0 ? {} : { entityIds: [...sceneSelection.entityIds] }
	};
}
var VIEW_WORKSPACE_API_VERSION = "forgeax.view.workspace/1";
var VIEW_WORKSPACE_SERVICES = Object.freeze({
	capabilities: "forgeax.view.workspace.capabilities",
	call: "forgeax.view.workspace.call"
});
var VIEW_FILE_GET_SERVICE = "forgeax.view.file.get";
var VIEW_HTML_FILES_SERVICE = "forgeax.view.html.files";
var VIEW_PACK_SOURCES_SERVICE = "forgeax.view.pack.sources";
var VIEW_PACK_REVEAL_TOPIC = "forgeax.view.pack.reveal";
var VIEW_PACK_REVEAL_ACK_SERVICE = "forgeax.view.pack.reveal.ack";
var VIEW_WORKSPACE_STATE_TOPIC = "forgeax.view.workspace.state";
var VIEW_PAGE_TYPES = Object.freeze({
	history: "history",
	scene: "scene",
	display: "display",
	plugins: "plugins",
	material: "material",
	mesh: "mesh",
	texture: "texture",
	asset: "asset",
	html: "html"
});
Object.freeze(["rebuild", "cold-cook"]);
var VIEW_WORKSPACE_CORE_OPERATION_EFFECTS = Object.freeze({
	"presentation.get": "query",
	"presentation.page.open": "command",
	"presentation.page.select": "command",
	"presentation.page.close": "command",
	"presentation.panel.reveal": "command",
	"summary.get": "query",
	"pages.list": "query",
	"pack.reveal": "command",
	"tabs.get": "query",
	"tabs.select": "command",
	"scene.select": "command",
	"scene.pick": "command",
	"scene.clear": "command",
	"project.open": "command",
	"project.close": "command",
	"project.reopen": "command"
});
var VIEW_WORKSPACE_DOMAIN_OPERATION_EFFECTS = Object.freeze({
	...VIEW_WORKSPACE_CORE_OPERATION_EFFECTS,
	"history.list": "query",
	"history.get": "query",
	"history.artifact.read": "query",
	"display.bind": "command",
	"display.status": "query",
	"assets.list": "query",
	"assets.thumbnails": "query",
	"asset.inspect": "command",
	"asset.source.rebuild": "command",
	"asset.source.cold-cook": "command",
	"asset.source.draft": "command",
	"asset.open": "command",
	"runtime-pack.inspect": "query",
	"runtime-pack.admit": "command",
	"runtime-pack.generate": "command",
	"runtime-pack.snapshot": "command",
	"runtime-pack.restore": "command",
	"runtime-pack.withdraw": "command",
	"runtime-pack.plugin-install": "command",
	"runtime-pack.plugin-inspect": "query",
	"runtime-pack.plugin-dispose": "command",
	"runtime-pack.prepare": "command",
	"play.start": "command",
	"play.ready": "command",
	"play.stop": "command",
	"target.control": "command",
	"target.select": "command",
	"target.pick": "query",
	"entity.highlight": "command",
	"preview.close": "command",
	"preview.capture": "command",
	"preview.resize": "command",
	"preview.texture.get": "query",
	"preview.material.get": "query",
	"preview.material.set": "command",
	"preview.material.rotate": "command",
	"preview.material.reset": "command",
	"preview.texture.set": "command",
	"preview.display.get": "query",
	"preview.display.set": "command",
	"camera.get": "query",
	"camera.begin": "command",
	"camera.update": "command",
	"camera.commit": "command",
	"camera.abort": "command",
	"scene.tree.get": "query",
	"entity.inspect": "query",
	"entity.focus": "command",
	"run.start": "command",
	"run.status": "query",
	"run.reload": "command",
	"run.stop": "command",
	"run.capture": "command",
	"run.eval": "command",
	"run.find": "query",
	"run.focus": "command",
	"run.camera.get": "query",
	"run.camera.set": "command",
	"run.camera.release": "command"
});
var VIEW_WORKSPACE_OPERATION_EFFECTS = Object.freeze({
	...VIEW_WORKSPACE_DOMAIN_OPERATION_EFFECTS,
	"plugins.sources": "query",
	"plugins.inspect": "query",
	"plugins.watch": "command"
});
Object.freeze(Object.keys(VIEW_WORKSPACE_CORE_OPERATION_EFFECTS));
var VIEW_WORKSPACE_DOMAIN_OPERATIONS = Object.freeze(Object.keys(VIEW_WORKSPACE_DOMAIN_OPERATION_EFFECTS));
var VIEW_WORKSPACE_OPERATIONS = Object.freeze(Object.keys(VIEW_WORKSPACE_OPERATION_EFFECTS));
var VIEW_DISPLAY_TAB_ID = "forgeax-cli-display";
var VIEW_WORKSPACE_TAB_ID = "forgeax-user-workspace";
var OPERATION_SET = new Set(VIEW_WORKSPACE_OPERATIONS);
var OPAQUE_WORKSPACE_DIAGNOSTICS = /* @__PURE__ */ new Set([
	"the contribution executor to return a result",
	"the producer operation to succeed",
	"the workspace command to complete",
	"Inspect the resident View workspace and retry.",
	"Inspect the provider snapshot and retry.",
	"Inspect detail and repair the owning producer before retrying.",
	"Inspect the browser page failure details.",
	"Inspect the Engine command or tool result.",
	"Refresh the inspector source and retry.",
	"the View workspace provider to complete the operation",
	"the View API provider to complete the operation"
]);
function isOpaqueWorkspaceDiagnostic(value) {
	if (typeof value !== "string") return true;
	const text = value.trim();
	if (text === "") return true;
	if (OPAQUE_WORKSPACE_DIAGNOSTICS.has(text)) return true;
	if (/^the browser workspace operation \S+ to complete$/.test(text)) return true;
	if (/^(?:workspace|inspector) operation \S+ to complete$/.test(text)) return true;
	if (/^Engine .+ to succeed$/.test(text)) return true;
	return false;
}
function workspaceErrorMessage(code, expected, hint) {
	const parts = [];
	for (const value of [expected, hint]) {
		if (typeof value !== "string") continue;
		const text = value.trim();
		if (!text || parts.includes(text)) continue;
		parts.push(text);
	}
	const real = parts.filter((text) => !isOpaqueWorkspaceDiagnostic(text));
	const chosen = real.length > 0 ? real : parts;
	return chosen.length > 0 ? `${code}: ${chosen.join(" — ")}` : String(code ?? "view-workspace-error");
}
var ViewWorkspaceError = class extends Error {
	constructor(code, expected, hint, detail = {}) {
		super(workspaceErrorMessage(code, expected, hint));
		this.name = "ViewWorkspaceError";
		this.code = code;
		this.expected = expected;
		this.hint = hint;
		this.detail = detail;
	}
};
function workspaceError(code, expected, hint, detail = {}) {
	return new ViewWorkspaceError(code, expected, hint, detail);
}
function requireWorkspaceString(value, field) {
	if (typeof value !== "string" || value.trim() === "") throw workspaceError("view-workspace-invalid-args", `${field} to be a non-empty string`, `Provide a non-empty ${field}.`, { field });
	return value;
}
function requireWorkspaceObject(value, field) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw workspaceError("view-workspace-invalid-args", `${field} to be an object`, `Provide an object for ${field}.`, { field });
	return value;
}
function requireWorkspaceInteger(value, field, { min = 0 } = {}) {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) throw workspaceError("view-workspace-invalid-args", `${field} to be an integer >= ${min}`, `Provide a valid ${field}.`, {
		field,
		min
	});
	return value;
}
function cloneWorkspaceValue(value) {
	if (value === void 0) return value;
	return JSON.parse(JSON.stringify(value));
}
function omitUiTelemetry(value) {
	if (Array.isArray(value)) return value.map(omitUiTelemetry);
	if (!value || typeof value !== "object") return value;
	const next = {};
	for (const [key, nested] of Object.entries(value)) {
		if (key === "frameId" || key === "cameraVersion" || key === "interaction" || key === "inputVersion") continue;
		if (key === "camera" && nested && typeof nested === "object" && !Array.isArray(nested)) {
			if ("control" in nested && nested.control !== void 0) next.camera = { control: nested.control };
			continue;
		}
		next[key] = omitUiTelemetry(nested);
	}
	return next;
}
function workspaceUiFingerprint(state) {
	if (!state) return "";
	const { revision: _revision, ...rest } = state;
	return JSON.stringify(omitUiTelemetry(rest));
}
function createWorkspaceRequest(operation, args = {}, { clientId, token, requestId } = {}) {
	if (!OPERATION_SET.has(operation)) throw workspaceError("view-workspace-operation-unknown", "operation to be present in the View workspace API", "Refresh the workspace API capabilities and use a supported operation.", { operation });
	const request = {
		apiVersion: VIEW_WORKSPACE_API_VERSION,
		operation,
		clientId: requireWorkspaceString(clientId, "clientId"),
		requestId: requestId === void 0 ? createWorkspaceId("request") : requireWorkspaceString(requestId, "requestId"),
		args: requireWorkspaceObject(args, "args")
	};
	if (token !== void 0) request.token = requireWorkspaceString(token, "token");
	return Object.freeze(request);
}
function assertWorkspaceRequest(value) {
	const request = requireWorkspaceObject(value, "request");
	if (request.apiVersion !== "forgeax.view.workspace/1") throw workspaceError("view-workspace-version-mismatch", `API version ${VIEW_WORKSPACE_API_VERSION}`, "Install a matching View workspace client.", {
		actual: request.apiVersion,
		expected: VIEW_WORKSPACE_API_VERSION
	});
	if (typeof request.operation !== "string" || !OPERATION_SET.has(request.operation)) throw workspaceError("view-workspace-operation-unknown", "operation to be present in the View workspace API", "Refresh the workspace API capabilities and use a supported operation.", { operation: request.operation });
	requireWorkspaceString(request.clientId, "clientId");
	requireWorkspaceString(request.requestId, "requestId");
	requireWorkspaceObject(request.args, "args");
	return request;
}
function workspaceCapabilities({ ready = true, headed = ready, reason, code, operations = VIEW_WORKSPACE_OPERATIONS } = {}) {
	return {
		apiVersion: VIEW_WORKSPACE_API_VERSION,
		ready: Boolean(ready),
		headed: Boolean(headed),
		operations: [...operations],
		...reason === void 0 ? {} : { reason: String(reason) },
		...code === void 0 ? {} : { code: String(code) }
	};
}
function serializeWorkspaceTarget(target) {
	if (!target) return null;
	requireWorkspaceString(target.targetId, "target.targetId");
	return {
		targetId: target.targetId,
		...target.generation === void 0 ? {} : { generation: target.generation },
		...target.sessionId === void 0 ? {} : { sessionId: String(target.sessionId) },
		...target.worldId === void 0 ? {} : { worldId: String(target.worldId) },
		headed: target.headed === true,
		...target.frameId === void 0 ? {} : { frameId: target.frameId },
		...target.width === void 0 ? {} : { width: target.width },
		...target.height === void 0 ? {} : { height: target.height },
		...target.url === void 0 ? {} : { url: String(target.url) },
		...target.surface === void 0 || typeof target.surface !== "string" ? {} : { surface: target.surface }
	};
}
function serializeWorkspaceProject(project) {
	if (!project) return null;
	requireWorkspaceString(project.id, "project.id");
	requireWorkspaceString(project.root, "project.root");
	return {
		id: project.id,
		root: project.root,
		...project.assetRoots === void 0 ? {} : { assetRoots: [...project.assetRoots] },
		...project.name === void 0 ? {} : { name: String(project.name) },
		...project.revision === void 0 ? {} : { revision: String(project.revision) }
	};
}
function serializeWorkspaceAsset(asset) {
	requireWorkspaceString(asset.guid, "asset.guid");
	requireWorkspaceString(asset.kind, "asset.kind");
	return {
		guid: asset.guid,
		kind: asset.kind,
		...asset.name === void 0 ? {} : { name: String(asset.name) },
		...asset.sourceKey === void 0 ? {} : { sourceKey: String(asset.sourceKey) },
		...asset.path === void 0 ? {} : { path: String(asset.path) },
		...asset.sourcePath === void 0 ? {} : { sourcePath: String(asset.sourcePath) },
		...asset.sourceKind === void 0 ? {} : { sourceKind: String(asset.sourceKind) },
		...asset.packageId === void 0 ? {} : { packageId: String(asset.packageId) },
		...asset.lifecycle === void 0 ? {} : { lifecycle: asset.lifecycle },
		...asset.packageUrl === void 0 ? {} : { packageUrl: String(asset.packageUrl) },
		...asset.cookReceiptUrl === void 0 ? {} : { cookReceiptUrl: String(asset.cookReceiptUrl) },
		...asset.label === void 0 ? {} : { label: String(asset.label) },
		...asset.revision === void 0 ? {} : { revision: String(asset.revision) },
		...asset.publicationId === void 0 ? {} : { publicationId: String(asset.publicationId) },
		...asset.previewable === void 0 ? {} : { previewable: Boolean(asset.previewable) },
		...serializeWorkspaceDdc(asset.ddc) === void 0 ? {} : { ddc: serializeWorkspaceDdc(asset.ddc) }
	};
}
function serializeWorkspaceDdc(ddc) {
	if (!ddc || typeof ddc !== "object" || Array.isArray(ddc)) return void 0;
	const state = ddc.state === void 0 ? void 0 : String(ddc.state);
	return cloneWorkspaceValue({
		...state === void 0 ? {} : { state },
		...ddc.guid === void 0 ? {} : { guid: String(ddc.guid) },
		...ddc.desiredKey === void 0 ? {} : { desiredKey: String(ddc.desiredKey) },
		...ddc.receiptUrl === void 0 ? {} : { receiptUrl: String(ddc.receiptUrl) },
		...ddc.hint === void 0 ? {} : { hint: String(ddc.hint) }
	});
}
function serializeWorkspaceOpenRequest(request) {
	if (!request) return null;
	requireWorkspaceString(request.requestId, "openRequest.requestId");
	requireWorkspaceInteger(request.sequence, "openRequest.sequence", { min: 1 });
	const asset = serializeWorkspaceAsset(request.asset);
	const previewTarget = request.preview?.target ?? request.target;
	const previewAsset = request.preview?.asset ?? (previewTarget ? asset : void 0);
	return {
		requestId: request.requestId,
		sequence: request.sequence,
		...request.phase ? { phase: request.phase } : {},
		...request.failure ? { failure: { ...request.failure } } : {},
		asset,
		...request.detailsOnly ? { detailsOnly: true } : {},
		...previewTarget ? { preview: {
			asset: previewAsset ? serializeWorkspaceAsset(previewAsset) : asset,
			target: serializeWorkspaceTarget(previewTarget),
			...request.preview?.assetBinding ? { assetBinding: cloneWorkspaceValue(request.preview.assetBinding) } : {}
		} } : {},
		...request.inspection ? { inspection: serializeWorkspaceInspection(request.inspection) } : {}
	};
}
function serializeWorkspaceResourceOpens(opens) {
	if (!opens || typeof opens !== "object") return void 0;
	const entries = opens instanceof Map ? [...opens.entries()] : Object.entries(opens);
	const serialized = {};
	for (const [kind, entry] of entries) {
		if (typeof kind !== "string" || !entry?.asset) continue;
		const asset = serializeWorkspaceAsset(entry.asset);
		const previewTarget = entry.preview?.target;
		serialized[kind] = {
			asset,
			...entry.catalogEpoch === void 0 ? {} : { catalogEpoch: entry.catalogEpoch },
			...entry.requestId ? { requestId: entry.requestId } : {},
			...entry.pending ? { pending: serializeWorkspaceOpenRequest(entry.pending) } : {},
			...entry.detailsOnly ? { detailsOnly: true } : {},
			...entry.sequence === void 0 ? {} : { sequence: entry.sequence },
			...previewTarget ? { preview: {
				asset: serializeWorkspaceAsset(entry.preview?.asset ?? asset),
				target: serializeWorkspaceTarget(previewTarget),
				...entry.preview?.assetBinding ? { assetBinding: cloneWorkspaceValue(entry.preview.assetBinding) } : {}
			} } : {}
		};
	}
	return serialized;
}
function serializeWorkspaceInspection(inspection) {
	if (!inspection) return null;
	const guid = requireWorkspaceString(inspection.guid ?? inspection.asset?.guid, "inspection.guid");
	const asset = serializeWorkspaceAsset({
		...inspection.asset,
		guid,
		kind: requireWorkspaceString(inspection.asset?.kind ?? inspection.kind, "inspection.kind")
	});
	const source = inspection.source;
	return {
		guid,
		asset,
		...source === void 0 || source === null ? {} : { source: {
			...source.path === void 0 ? {} : { path: String(source.path) },
			...source.kind === void 0 ? {} : { kind: String(source.kind) },
			...source.revision === void 0 ? {} : { revision: String(source.revision) },
			...source.publication === void 0 ? {} : { publication: cloneWorkspaceValue(source.publication) }
		} },
		...inspection.meta !== null && typeof inspection.meta === "object" && !Array.isArray(inspection.meta) ? { meta: cloneWorkspaceValue(inspection.meta) } : {},
		...serializeWorkspaceDdc(inspection.ddc) === void 0 ? {} : { ddc: serializeWorkspaceDdc(inspection.ddc) },
		...inspection.revision === void 0 ? {} : { revision: String(inspection.revision) },
		...inspection.publication === void 0 ? {} : { publication: cloneWorkspaceValue(inspection.publication) }
	};
}
function serializeWorkspaceState(state) {
	return cloneWorkspaceValue({
		apiVersion: VIEW_WORKSPACE_API_VERSION,
		revision: state.revision,
		selectedTabId: state.selectedTabId,
		tabs: state.tabs,
		project: serializeWorkspaceProject(state.project),
		...typeof state.projectIntent?.root === "string" ? { projectIntent: { root: state.projectIntent.root } } : {},
		projectTarget: serializeWorkspaceTarget(state.projectTarget),
		assets: Array.isArray(state.assets) ? state.assets.map((asset) => serializeWorkspaceAsset(asset)) : null,
		preview: state.preview ? {
			asset: state.preview.asset ? serializeWorkspaceAsset(state.preview.asset) : null,
			target: serializeWorkspaceTarget(state.preview.target),
			assetBinding: state.preview.assetBinding,
			camera: state.preview.camera,
			cameraVersion: state.preview.cameraVersion,
			interaction: state.preview.interaction ? { interactionId: state.preview.interaction.interactionId } : null
		} : null,
		previews: (state.previews ?? []).map((preview) => ({
			target: serializeWorkspaceTarget(preview.target),
			asset: preview.asset ? serializeWorkspaceAsset(preview.asset) : null,
			assetBinding: preview.assetBinding
		})),
		scenePreview: state.scenePreview ? {
			target: serializeWorkspaceTarget(state.scenePreview.target),
			asset: state.scenePreview.asset ? serializeWorkspaceAsset(state.scenePreview.asset) : null,
			assetBinding: state.scenePreview.assetBinding
		} : null,
		play: state.play ? {
			target: serializeWorkspaceTarget(state.play.target),
			phase: state.play.phase
		} : null,
		targetBinding: state.targetBinding ?? "scene",
		inspection: serializeWorkspaceInspection(state.inspection),
		openRequest: serializeWorkspaceOpenRequest(state.openRequest),
		resourceOpens: serializeWorkspaceResourceOpens(state.resourceOpens),
		sceneSelection: serializeWorkspaceSceneSelection(state.sceneSelection),
		workspaceTargetLost: state.workspaceTargetLost === true,
		...state.projectPhase === void 0 ? {} : { projectPhase: state.projectPhase },
		...state.browserGeneration === void 0 ? {} : { browserGeneration: state.browserGeneration },
		...state.catalogEpoch === void 0 ? {} : { catalogEpoch: state.catalogEpoch },
		...state.thumbnailEpoch === void 0 ? {} : { thumbnailEpoch: state.thumbnailEpoch }
	});
}
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-A74C2YPQ.mjs
function viewProjectOpenError(code, hint, detail) {
	return Object.assign(new Error(hint), {
		name: "ViewProjectOpenError",
		code,
		expected: hint,
		hint,
		...detail === void 0 ? {} : { detail }
	});
}
async function projectIdentity(input) {
	const resolved = resolve(String(input ?? ""));
	try {
		return await realpath(resolved);
	} catch {
		return resolved;
	}
}
function publishedProject(snapshot, viewerUrl, alreadyOpen) {
	const project = snapshot?.project;
	const target = snapshot?.projectTarget;
	if (typeof project?.root !== "string" || project.root.trim() === "" || typeof target?.url !== "string" || target.url.trim() === "") throw viewProjectOpenError("view-project-open-incomplete", "The opened project did not publish a headed target URL.", { project: project ?? null });
	return {
		alreadyOpen,
		...typeof viewerUrl === "string" && viewerUrl !== "" ? { viewerUrl } : {},
		project: {
			id: project.id,
			root: project.root,
			...project.name === void 0 ? {} : { name: project.name }
		},
		projectTarget: {
			url: target.url,
			...target.targetId === void 0 ? {} : { targetId: target.targetId }
		}
	};
}
async function openViewProject(workspace, projectPath, { signal, viewerUrl } = {}) {
	if (!workspace || typeof workspace.snapshot !== "function" || typeof workspace.openProject !== "function") throw viewProjectOpenError("view-not-started", "Run forgeax backend start, then forgeax view start.");
	if (signal?.aborted) throw viewProjectOpenError("view-not-started", "View has stopped. Run forgeax view start again when needed.");
	if (typeof projectPath !== "string" || projectPath.trim() === "") throw viewProjectOpenError("view-project-required", "Pass --project with the project directory.");
	const requested = await projectIdentity(projectPath);
	if (!requested.trim()) throw viewProjectOpenError("view-project-required", "Pass --project with the project directory.");
	const current = workspace.snapshot();
	const currentRoot = current?.project?.root;
	if (typeof currentRoot === "string" && currentRoot.trim() !== "") {
		if (await projectIdentity(currentRoot) !== requested) throw viewProjectOpenError("view-project-already-open", "The current project stays open. This command does not switch projects.", { root: currentRoot });
		if (current.workspaceTargetLost !== true && typeof current.projectTarget?.url === "string" && current.projectTarget.url !== "") return publishedProject(current, viewerUrl, true);
	}
	let opened;
	try {
		opened = await workspace.openProject({
			root: requested,
			tabId: VIEW_WORKSPACE_TAB_ID
		}, { signal });
	} catch (error) {
		if (signal?.aborted) throw viewProjectOpenError("view-not-started", "View has stopped. Run forgeax view start again when needed.");
		throw error;
	}
	if (signal?.aborted) throw viewProjectOpenError("view-not-started", "View has stopped. Run forgeax view start again when needed.");
	return publishedProject(opened, viewerUrl, false);
}
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-QM4OXM2S.mjs
function installedEngineRoot() {
	try {
		return dirname(createRequire(import.meta.url).resolve("@forgeax/engine/package.json"));
	} catch {
		return;
	}
}
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-YY4G5LVX.mjs
async function disposeResource(resource) {
	if (!resource) return;
	if (typeof resource === "function") {
		await resource();
		return;
	}
	if (typeof resource.dispose === "function") {
		await resource.dispose();
		return;
	}
	if (typeof resource.close === "function") await resource.close();
}
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-YRUOXIGJ.mjs
var VIEW_PROTOCOL = "forgeax-view/1";
var VIEW_CARRIER = "view";
var BROWSER_CARRIER = "private-browser";
var GPU_MODES = Object.freeze([
	"auto",
	"hardware",
	"software"
]);
var FALLBACK_REASONS = Object.freeze({
	HEADLESS_REQUESTED: "headless-requested",
	PROTOCOL_UNSUPPORTED: "view-protocol-unsupported",
	CAPABILITY_MISMATCH: "view-capability-mismatch",
	OCCUPIED: "view-occupied",
	CANCELLED: "view-cancelled",
	STALE_GENERATION: "view-stale-generation",
	TARGET_LOST: "view-target-lost",
	ALLOCATION_FAILED: "view-allocation-failed"
});
var FALLBACK_REASON_VALUES = new Set(Object.values(FALLBACK_REASONS));
function requireString(value, field) {
	if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${field} must be a non-empty string`);
	return value;
}
function requireInteger(value, field) {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative safe integer`);
	return value;
}
function createRunIdentity({ serviceId, runId }) {
	const identity = Object.freeze({
		serviceId: requireString(serviceId, "serviceId"),
		runId: requireString(runId, "runId")
	});
	return Object.freeze({
		...identity,
		key: `${identity.serviceId}:${identity.runId}`
	});
}
function normalizeRunIdentity(run) {
	if (!run || typeof run !== "object") throw new TypeError("run identity is required");
	return createRunIdentity(run);
}
function createLeaseRequest({ run, generation, headless = false, gpu = "auto", width = 1280, height = 720, metadata } = {}) {
	const identity = normalizeRunIdentity(run);
	const normalizedGeneration = requireInteger(generation, "generation");
	if (!GPU_MODES.includes(gpu)) throw new TypeError(`gpu must be one of ${GPU_MODES.join(", ")}`);
	if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) throw new TypeError("width and height must be positive safe integers");
	return Object.freeze({
		run: identity,
		generation: normalizedGeneration,
		headless: Boolean(headless),
		gpu,
		width,
		height,
		...metadata === void 0 ? {} : { metadata }
	});
}
function sameRun(a, b) {
	return Boolean(a && b && a.serviceId === b.serviceId && a.runId === b.runId);
}
function assertLeaseTarget(target) {
	if (!target || typeof target !== "object") throw new TypeError("lease target is required");
	requireString(target.leaseId, "leaseId");
	requireString(target.targetId, "targetId");
	requireString(target.kind, "target.kind");
	requireString(target.surfaceId, "surfaceId");
	if (!/^[_A-Za-z][_A-Za-z0-9-]*$/.test(target.surfaceId)) throw new TypeError("surfaceId must be a stable DOM id");
	normalizeRunIdentity(target.run);
	requireInteger(target.generation, "target.generation");
	return target;
}
function viewDecision({ target, release, request }) {
	assertLeaseTarget(target);
	if (typeof release !== "function") throw new TypeError("View decision release must be a function");
	return Object.freeze({
		carrier: VIEW_CARRIER,
		target,
		release,
		request
	});
}
function browserFallback(reason, details = {}) {
	if (!FALLBACK_REASON_VALUES.has(reason)) throw new TypeError(`unknown View fallback reason: ${reason}`);
	return Object.freeze({
		carrier: BROWSER_CARRIER,
		fallbackReason: reason,
		...details
	});
}
function serializeTarget(target) {
	assertLeaseTarget(target);
	return {
		leaseId: target.leaseId,
		targetId: target.targetId,
		kind: target.kind,
		surfaceId: target.surfaceId,
		run: { ...target.run },
		generation: target.generation,
		width: target.width,
		height: target.height,
		gpu: target.gpu
	};
}
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-GQANC3HH.mjs
var DEFAULT_CAPABILITIES = Object.freeze({
	protocolVersion: 1,
	ready: true,
	supportsPage: true,
	gpuModes: ["auto"],
	maxWidth: 8192,
	maxHeight: 8192,
	canvasSizing: "fixed"
});
function copyCapabilities(capabilities = {}) {
	const merged = {
		...DEFAULT_CAPABILITIES,
		...capabilities,
		gpuModes: [...capabilities.gpuModes ?? DEFAULT_CAPABILITIES.gpuModes]
	};
	if (!Number.isInteger(merged.protocolVersion)) merged.protocolVersion = 1;
	return Object.freeze(merged);
}
function targetMatches(target, active) {
	return Boolean(target && active && target.leaseId === active.leaseId && target.targetId === active.target?.targetId && target.surfaceId === active.target?.surfaceId && target.generation === active.request.generation && sameRun(target.run, active.request.run));
}
function allocationFailureReason(error) {
	if (error && typeof error === "object" && "fallbackReason" in error && Object.values(FALLBACK_REASONS).includes(error.fallbackReason)) return error.fallbackReason;
	return FALLBACK_REASONS.ALLOCATION_FAILED;
}
var ViewResourceBroker = class {
	constructor({ platform, capabilities, idFactory = randomUUID, clock = () => Date.now() } = {}) {
		if (!platform || typeof platform.createPage !== "function") throw new TypeError("ViewResourceBroker requires a platform.createPage implementation");
		this.platform = platform;
		this.capabilityOverrides = { ...capabilities ?? {} };
		this.capabilities = copyCapabilities({
			...typeof platform.getCapabilities === "function" ? platform.getCapabilities() : {},
			...this.capabilityOverrides
		});
		this.idFactory = idFactory;
		this.clock = clock;
		this.active = null;
		this.pending = null;
		this.latestGenerations = /* @__PURE__ */ new Map();
		this.listeners = /* @__PURE__ */ new Set();
		this.disposing = false;
	}
	/** Subscribe to status transitions owned by this broker. */
	subscribe(listener) {
		if (typeof listener !== "function") throw new TypeError("broker status listener must be a function");
		this.listeners.add(listener);
		listener(this.handshake());
		return () => this.listeners.delete(listener);
	}
	notify() {
		const snapshot = this.handshake();
		for (const listener of this.listeners) try {
			listener(snapshot);
		} catch {}
	}
	refreshCapabilities() {
		if (typeof this.platform.getCapabilities !== "function") return this.capabilities;
		const live = this.platform.getCapabilities() ?? {};
		const overrides = { ...this.capabilityOverrides };
		delete overrides.ready;
		delete overrides.supportsPage;
		delete overrides.gpuModes;
		this.capabilities = copyCapabilities({
			...live,
			...overrides
		});
		return this.capabilities;
	}
	handshake() {
		const capabilities = this.refreshCapabilities();
		return {
			protocol: VIEW_PROTOCOL,
			protocolVersion: 1,
			state: this.disposing ? "stopping" : !capabilities.ready || !capabilities.supportsPage ? "unavailable" : this.active ? "occupied" : this.pending ? "allocating" : "ready",
			capabilities: {
				...capabilities,
				gpuModes: [...capabilities.gpuModes]
			},
			occupancy: this.active ? {
				leaseId: this.active.leaseId,
				run: { ...this.active.request.run },
				generation: this.active.request.generation,
				...this.active.target?.targetId === void 0 ? {} : { targetId: this.active.target.targetId },
				...this.active.target?.targetId === void 0 ? {} : { target: serializeTarget(this.active.target) }
			} : null
		};
	}
	get occupied() {
		return this.active !== null;
	}
	capabilityFailure(request) {
		const capabilities = this.refreshCapabilities();
		if (this.disposing || !capabilities.ready || !capabilities.supportsPage) return "View platform is not ready";
		if (capabilities.protocolVersion !== 1) throw Object.assign(/* @__PURE__ */ new Error(`View protocol ${capabilities.protocolVersion} is incompatible`), { fallbackReason: FALLBACK_REASONS.PROTOCOL_UNSUPPORTED });
		if (!capabilities.gpuModes.includes(request.gpu)) return `View does not support GPU mode ${request.gpu}`;
		if (request.width > capabilities.maxWidth || request.height > capabilities.maxHeight) return `requested canvas ${request.width}x${request.height} exceeds View limits`;
		return null;
	}
	async allocate(input, { signal } = {}) {
		const request = createLeaseRequest(input);
		if (request.headless) return browserFallback(FALLBACK_REASONS.HEADLESS_REQUESTED);
		if (signal?.aborted || this.disposing) return browserFallback(FALLBACK_REASONS.CANCELLED);
		const latest = this.latestGenerations.get(request.run.key);
		if (latest !== void 0 && request.generation < latest) return browserFallback(FALLBACK_REASONS.STALE_GENERATION, { currentGeneration: latest });
		if (latest === void 0 || request.generation > latest) this.latestGenerations.set(request.run.key, request.generation);
		try {
			const capabilityMessage = this.capabilityFailure(request);
			if (capabilityMessage) return browserFallback(FALLBACK_REASONS.CAPABILITY_MISMATCH, { message: capabilityMessage });
		} catch (error) {
			if (error && typeof error === "object" && "fallbackReason" in error && error.fallbackReason === FALLBACK_REASONS.PROTOCOL_UNSUPPORTED) return browserFallback(FALLBACK_REASONS.PROTOCOL_UNSUPPORTED, { message: error instanceof Error ? error.message : String(error) });
			throw error;
		}
		if (this.active || this.pending) {
			const occupied = this.active ?? this.pending;
			return browserFallback(FALLBACK_REASONS.OCCUPIED, { occupiedBy: { ...occupied.request.run } });
		}
		const leaseId = this.idFactory();
		const controller = new AbortController();
		const reservation = {
			leaseId,
			request,
			controller,
			state: "allocating",
			cancelled: false,
			page: null,
			target: null,
			pageLost: null
		};
		this.pending = reservation;
		this.notify();
		const onAbort = () => {
			reservation.cancelled = true;
			controller.abort();
		};
		const onPageLost = (reason) => {
			if (this.active !== reservation && this.pending !== reservation) return;
			reservation.pageLost = reason ?? "page-lost";
			reservation.state = "lost";
			this.active = null;
			if (this.pending === reservation) this.pending = null;
			this.notify();
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		let page;
		try {
			page = await this.platform.createPage({
				leaseId,
				run: request.run,
				generation: request.generation,
				width: request.width,
				height: request.height,
				gpu: request.gpu,
				signal: controller.signal,
				onLost: onPageLost
			});
			if (reservation.pageLost) {
				await disposeResource(page);
				return browserFallback(FALLBACK_REASONS.TARGET_LOST, { message: reservation.pageLost });
			}
			if (reservation.cancelled || controller.signal.aborted || this.pending !== reservation || this.disposing) {
				await disposeResource(page);
				return browserFallback(FALLBACK_REASONS.CANCELLED);
			}
			if (!page || typeof page.targetId !== "string" && typeof page.targetId !== "number" || typeof page.surfaceId !== "string" || !/^[_A-Za-z][_A-Za-z0-9-]*$/.test(page.surfaceId)) throw new Error("platform did not return a stable page target and surface id");
			reservation.page = page;
			reservation.state = "active";
			reservation.target = Object.freeze({
				leaseId,
				targetId: String(page.targetId),
				kind: page.kind ?? "browser-page",
				surfaceId: page.surfaceId,
				run: request.run,
				generation: request.generation,
				width: request.width,
				height: request.height,
				gpu: request.gpu,
				allocatedAt: this.clock()
			});
			this.pending = null;
			this.active = reservation;
			this.notify();
			return viewDecision({
				target: reservation.target,
				request,
				release: (reason = "engine-release") => this.release(reservation.target, reason)
			});
		} catch (error) {
			if (page) await disposeResource(page).catch(() => {});
			if (reservation.cancelled || controller.signal.aborted) return browserFallback(FALLBACK_REASONS.CANCELLED);
			return browserFallback(allocationFailureReason(error), { message: error instanceof Error ? error.message : String(error) });
		} finally {
			signal?.removeEventListener("abort", onAbort);
			if (this.pending === reservation) this.pending = null;
			if (this.active === reservation && reservation.state !== "active") this.active = null;
			if (this.active === null) this.notify();
		}
	}
	/** Return the exact platform page for an in-process Engine adapter. */
	getPage(target) {
		if (!targetMatches(target, this.active) || this.active.state !== "active") throw new Error("View target is not an active lease");
		return this.active.page.page;
	}
	/** Return the exact Engine execution realm bound to the active target. */
	getExecution(target) {
		if (!targetMatches(target, this.active) || this.active.state !== "active") throw new Error("View target is not an active lease");
		const execution = this.active.page.execution;
		if (!execution || execution.ownerPage !== this.getPage(target)) throw new Error("View target does not expose an Engine execution realm");
		return execution;
	}
	async release(target, reason = "engine-release") {
		const reservation = this.active;
		if (!reservation) return {
			released: false,
			reason: "not-active"
		};
		if (!targetMatches(target, reservation)) return {
			released: false,
			reason: "lease-mismatch"
		};
		if (reservation.releasePromise) return reservation.releasePromise;
		reservation.state = "releasing";
		reservation.cancelled = true;
		reservation.controller.abort();
		this.notify();
		reservation.releasePromise = (async () => {
			try {
				await disposeResource(reservation.page);
				return {
					released: true,
					leaseId: reservation.leaseId,
					reason
				};
			} finally {
				reservation.state = "released";
				if (this.active === reservation) {
					this.active = null;
					this.notify();
				}
			}
		})();
		return reservation.releasePromise;
	}
	async cancel(run, generation) {
		const reservation = this.active ?? this.pending;
		if (!reservation || !sameRun(run, reservation.request.run) || reservation.request.generation !== generation) return {
			released: false,
			reason: "not-active"
		};
		if (reservation.target) return this.release(reservation.target, "cancelled");
		reservation.cancelled = true;
		reservation.controller.abort();
		if (this.pending === reservation) this.pending = null;
		this.notify();
		return {
			released: true,
			leaseId: reservation.leaseId,
			reason: "cancelled"
		};
	}
	async dispose() {
		if (this.disposing) return;
		this.disposing = true;
		this.notify();
		const reservation = this.active ?? this.pending;
		if (reservation?.target) await this.release(reservation.target, "broker-dispose");
		else if (reservation) {
			reservation.cancelled = true;
			reservation.controller.abort();
			if (this.pending === reservation) this.pending = null;
			if (this.active === reservation) this.active = null;
		}
		await this.platform.dispose?.();
	}
};
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-OX6EI5I6.mjs
function toolFailureError$2(failure) {
	const diagnostic = (typeof failure?.hint === "string" && failure.hint.trim() !== "" ? failure.hint : void 0) ?? (typeof failure?.expected === "string" && failure.expected.trim() !== "" ? failure.expected : void 0);
	const detail = failure.detail && typeof failure.detail === "object" && !Array.isArray(failure.detail) ? failure.detail : {};
	return Object.assign(new Error(diagnostic ?? String(failure ?? "view-status-provider-failed")), {
		name: "ViewToolError",
		code: detail.code ?? detail.remoteCode ?? failure.code,
		expected: failure.expected,
		hint: failure.hint ?? diagnostic,
		detail: failure.detail ?? { failure }
	});
}
async function runViewToolApi(api, { operation, args = {}, caller, signal, providerId, generation }) {
	const terminal = await api.run(operation, args, {
		sourceId: "view-backend",
		providerId,
		generation,
		caller,
		signal
	}).terminal;
	if (terminal.outcome === "failed") throw toolFailureError$2(terminal.failure);
	return terminal.result;
}
function createViewStatusToolContributions(broker, description) {
	return [defineTool({
		id: description.id,
		path: description.path,
		title: description.title,
		summary: description.summary,
		realm: "host",
		argsSchema: {
			parse(value) {
				return value === void 0 || value !== null && typeof value === "object" && !Array.isArray(value) ? {
					ok: true,
					value: value ?? {}
				} : {
					ok: false,
					error: "View status arguments must be an object"
				};
			},
			describe: "JSON object accepted by the read-only View status operation."
		},
		resultSchema: {
			parse(value) {
				return value !== null && typeof value === "object" && !Array.isArray(value) ? {
					ok: true,
					value
				} : {
					ok: false,
					error: "View status result must be an object"
				};
			},
			describe: "JSON object returned by the View status operation."
		},
		inputSchema: { type: "object" },
		outputSchema: { type: "object" },
		evidence: []
	}, async (_args, context) => broker.handshake(context.caller))];
}
var DISPLAY_STATUS_OPERATION_DESCRIPTION = Object.freeze({
	id: "view.display.status",
	path: [
		"view",
		"display",
		"status"
	],
	title: "View status",
	summary: "Read the current View display and workspace status."
});
var bindingInput = {
	type: "object",
	properties: {
		root: { type: ["string", "null"] },
		runId: {
			type: "string",
			minLength: 1
		}
	},
	required: ["root"],
	additionalProperties: false
};
var bindingArgs = {
	describe: JSON.stringify(bindingInput),
	parse(value) {
		const input = value;
		return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => key === "root" || key === "runId") && (input?.root === null || typeof input?.root === "string" && input?.root.trim() && (input.runId === void 0 || typeof input.runId === "string" && input.runId.trim())) ? {
			ok: true,
			value
		} : {
			ok: false,
			error: "Provide a project root, optionally an exact runId, or null root to disconnect."
		};
	}
};
function createDisplayApiTools(broker) {
	return [...createViewStatusToolContributions(broker, DISPLAY_STATUS_OPERATION_DESCRIPTION), ...broker.bind ? [defineTool({
		id: "view.display.bind",
		path: [
			"view",
			"display",
			"bind"
		],
		title: "Bind observed run",
		summary: "Observe a project run. Omit runId to discover and pin its current run once; null root disconnects. Never follows replacements.",
		realm: "host",
		argsSchema: bindingArgs,
		resultSchema: toolJsonSchema({ type: "object" }),
		inputSchema: bindingInput,
		outputSchema: { type: "object" },
		evidence: []
	}, (args, context) => broker.bind(args, context.caller, context.signal))] : []];
}
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-FLGC65SR.mjs
var __defProp = Object.defineProperty;
var __export = (target, all) => {
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
};
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-3A4PZK5C.mjs
var identity_exports$13 = {};
__export(identity_exports$13, {
	BACKEND_MODULE: () => BACKEND_MODULE$1,
	BACKEND_PLUGIN_ID: () => BACKEND_PLUGIN_ID$1,
	DISPLAY_SURFACE_ID: () => DISPLAY_SURFACE_ID,
	DISPLAY_TARGET_ROLE: () => DISPLAY_TARGET_ROLE,
	FRONTEND_MODULE: () => FRONTEND_MODULE$13,
	FRONTEND_PLUGIN_ID: () => FRONTEND_PLUGIN_ID$13,
	PAGE_TITLE_I18N_KEY: () => PAGE_TITLE_I18N_KEY$4,
	PAGE_TYPE: () => PAGE_TYPE$11,
	PLUGIN_ID: () => PLUGIN_ID$9,
	VIEW_STATUS_SERVICE: () => VIEW_STATUS_SERVICE,
	VIEW_STATUS_TOPIC: () => VIEW_STATUS_TOPIC
});
var PLUGIN_ID$9 = "forgeax.view.display";
var BACKEND_PLUGIN_ID$1 = "forgeax.view.service.display-carrier.backend";
var FRONTEND_PLUGIN_ID$13 = "forgeax.view.page.ai-display.frontend";
var BACKEND_MODULE$1 = "@forgeax/view/plugins/display/backend";
var FRONTEND_MODULE$13 = "@forgeax/view/plugins/display/frontend";
var PAGE_TYPE$11 = VIEW_PAGE_TYPES.display;
var PAGE_TITLE_I18N_KEY$4 = "view.pages.display";
var DISPLAY_SURFACE_ID = "forgeax-view-display-surface";
var DISPLAY_TARGET_ROLE = "ai-control";
var VIEW_STATUS_TOPIC = "forgeax.view.status";
var VIEW_STATUS_SERVICE = "forgeax.view.status.get";
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-JU5PV2T2.mjs
var ViewCarrierAdapter = class {
	constructor({ broker, attachTarget } = {}) {
		if (!broker || typeof broker.allocate !== "function" || typeof broker.release !== "function") throw new TypeError("View carrier adapter requires the in-process View resource broker");
		this.broker = broker;
		this.attachTarget = attachTarget;
	}
	async select(input, { signal } = {}) {
		const request = createLeaseRequest(input);
		if (request.headless) return browserFallback(FALLBACK_REASONS.HEADLESS_REQUESTED);
		const decision = await this.broker.allocate(request, { signal });
		return decision.carrier === "view" ? {
			...decision,
			carrier: "borrowed"
		} : decision;
	}
	async release(decision, reason = "engine-release") {
		if (!decision || decision.carrier !== "borrowed") return {
			released: false,
			reason: "not-borrowed"
		};
		return decision.release(reason);
	}
	/**
	* Optional local-process attachment hook. No browser connection implementation
	* is hidden here; the Engine browser layer supplies its public attachment
	* implementation and receives the exact allocated target handle.
	*/
	async attach(decision) {
		if (!decision || decision.carrier !== "borrowed") return decision;
		if (typeof this.attachTarget !== "function") throw new Error("Engine adapter must provide attachTarget for View pages");
		const attached = await this.attachTarget(decision.target);
		if (!attached || typeof attached !== "object" || !attached.page || !attached.execution || typeof attached.close !== "function") throw new TypeError("View attachTarget must return an explicit owner page, execution realm, and close handle");
		if (attached.execution.kind === "frame") {
			const identity = await attached.page.locator(attached.execution.surfaceSelector).evaluate((element) => ({
				id: element.id,
				leaseId: element.dataset.forgeaxViewLeaseId,
				generation: element.dataset.forgeaxViewGeneration
			}));
			if (identity.id !== decision.target.surfaceId || identity.leaseId !== decision.target.leaseId || identity.generation !== String(decision.target.generation)) {
				await attached.close("view-surface-identity-mismatch");
				throw new Error("View display surface no longer owns the selected lease");
			}
		}
		return {
			page: attached.page,
			target: decision.target,
			execution: attached.execution,
			close: attached.close
		};
	}
};
function createViewCarrierAdapter(options) {
	return new ViewCarrierAdapter(options);
}
Object.freeze({
	carrier: "borrowed",
	fallbackCarrier: BROWSER_CARRIER,
	protocolVersion: 1,
	targetIdentity: "leaseId + targetId + surfaceId + run identity + generation",
	ownership: "Engine owns attachment, navigation, observation, capture, and service lifetime"
});
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-CLP27E74.mjs
function bindPlatform(platform) {
	return {
		createPage: platform.createPage.bind(platform),
		...typeof platform.getCapabilities === "function" ? { getCapabilities: platform.getCapabilities.bind(platform) } : {},
		...typeof platform.dispose === "function" ? { dispose: platform.dispose.bind(platform) } : {}
	};
}
var backend_default$2 = {
	name: BACKEND_PLUGIN_ID$1,
	inject: ["viewWorkspaceCore", "toolApi"],
	provide: ["viewCapabilities", "viewStatus"],
	async apply(ctx, config = {}) {
		if (!config.platform) return installRunObserver(ctx);
		const broker = new ViewResourceBroker({
			platform: bindPlatform(config.platform),
			capabilities: config.capabilities
		});
		const carrier = createViewCarrierAdapter({
			broker,
			attachTarget(target) {
				return {
					page: broker.getPage(target),
					execution: broker.getExecution(target),
					close: async (reason = "engine-release") => {
						await broker.release(target, reason);
					}
				};
			}
		});
		const status = () => broker.handshake();
		const nativeTransport = ctx.get?.("hostTransport", false);
		const transport = nativeTransport && "register" in nativeTransport ? nativeTransport : void 0;
		const unsubscribeStatus = broker.subscribe((snapshot) => {
			transport?.publish?.(VIEW_STATUS_TOPIC, snapshot);
		});
		const toolApi = ctx.get?.("toolApi", false);
		ctx.get("viewWorkspaceCore");
		const statusTools = toolApi ? createDisplayApiTools(broker) : void 0;
		const statusProviderId = `view-display-status:${String(ctx.fiber.uid)}`;
		let revokeTools;
		let unregisterStatus;
		let statusOwner;
		ctx.effect(() => async () => {
			unregisterStatus?.();
			unsubscribeStatus();
			await revokeTools?.();
			await broker.dispose();
		});
		if (toolApi && statusTools) {
			revokeTools = registerTools(ctx, statusTools, {
				providerId: statusProviderId,
				sourceId: "view-backend",
				module: BACKEND_MODULE$1,
				realm: "host"
			});
			statusOwner = toolApi.describe(statusTools[0]?.descriptor.id, "view-backend")[0]?.owner;
		}
		unregisterStatus = transport?.register?.(VIEW_STATUS_SERVICE, ({ payload, signal, caller }) => statusOwner === void 0 ? broker.handshake() : runViewToolApi(toolApi, {
			operation: statusTools[0].descriptor.id,
			args: payload ?? {},
			signal,
			caller,
			providerId: statusOwner.providerId,
			generation: statusOwner.generation
		}));
		ctx.provide("viewBroker", broker);
		ctx.provide("viewCarrier", carrier);
		ctx.provide("viewCapabilities", broker.capabilities);
		ctx.provide("viewStatus", status);
	}
};
async function installRunObserver(ctx) {
	const transport = ctx.get("hostTransport");
	if (!transport || !("register" in transport)) throw new Error("Display backend requires a server transport");
	const api = ctx.get("toolApi");
	if (!api) throw new Error("Display backend requires ToolApi");
	const createSession = () => ({
		binding: null,
		snapshot: {
			status: "idle",
			binding: null,
			observation: null
		},
		controller: new AbortController()
	});
	const ordinary = createSession();
	const pages = /* @__PURE__ */ new Map();
	let disposed = false;
	const pageId = (caller) => {
		if (caller?.kind !== "frontend") return void 0;
		if (caller.sourceId === "view-frontend") return caller.connectionId;
		const resolve = ctx.get?.("engineWorkspaceForCaller", false);
		const target = (resolve ? resolve(caller) : ctx.get?.("engineWorkspace", false))?.project?.target;
		return target && caller.sourceId === `forgeax-workspace:${target.sessionId}:${target.targetId}` ? caller.connectionId : void 0;
	};
	const sessionFor = (caller) => {
		const id = pageId(caller);
		if (!id) return ordinary;
		let session = pages.get(id);
		if (!session) {
			session = createSession();
			pages.set(id, session);
		}
		return session;
	};
	const publish = (session, connectionId) => transport.publish(VIEW_STATUS_TOPIC, session.snapshot, connectionId ? { connectionId } : { excludeConnectionIds: [...pages.keys()] });
	const stopSession = (session) => {
		session.controller.abort();
		clearTimeout(session.timer);
		session.timer = void 0;
	};
	const observe = async (root, signal) => {
		const owner = api.describe("engine.run.observe", "engine-workspace").find((record) => record.callable)?.owner;
		if (!owner) throw new Error("Engine run observation is unavailable.");
		const terminal = await api.run("engine.run.observe", { root }, {
			sourceId: "engine-workspace",
			providerId: owner.providerId,
			generation: owner.generation,
			signal
		}).terminal;
		if (terminal.outcome === "failed") throw new Error(terminal.failure.hint);
		return terminal.result;
	};
	const accept = (session, selected, observation) => {
		const matches = observation.status?.runId === selected.runId;
		session.snapshot = matches ? {
			status: observation.status?.phase === "ready" ? "running" : observation.status?.phase ?? "idle",
			binding: selected,
			observation
		} : {
			status: "unavailable",
			binding: selected,
			observation: session.snapshot.observation ?? null,
			error: "The bound run is no longer active. Connect again to view the current run."
		};
		return matches;
	};
	const refresh = async (session, connectionId) => {
		const selected = session.binding;
		const signal = session.controller.signal;
		if (disposed || !selected || signal.aborted) return;
		let matches = true;
		try {
			const observation = await observe(selected.root, signal);
			if (disposed || signal.aborted || session.binding !== selected) return;
			matches = accept(session, selected, observation);
		} catch (error) {
			if (!signal.aborted && session.binding === selected) session.snapshot = {
				status: "unavailable",
				binding: selected,
				observation: session.snapshot.observation ?? null,
				error: String(error)
			};
		} finally {
			if (!disposed && !signal.aborted && session.binding === selected) {
				publish(session, connectionId);
				if (matches) {
					session.timer = setTimeout(() => void refresh(session, connectionId), 1e3);
					session.timer.unref?.();
				}
			}
		}
	};
	const status = (caller) => sessionFor(caller).snapshot;
	const unregister = transport.register(VIEW_STATUS_SERVICE, ({ caller }) => status(caller));
	const removeDisconnect = transport.onClientDisconnect((caller) => {
		const id = caller.connectionId;
		const session = pages.get(id);
		if (!session) return;
		pages.delete(id);
		stopSession(session);
	});
	const tools = createDisplayApiTools({
		handshake: status,
		async bind({ root, runId }, caller, signal) {
			const session = sessionFor(caller);
			stopSession(session);
			const controller = session.controller = new AbortController();
			session.binding = root !== null && runId !== void 0 ? {
				root: root.trim(),
				runId: runId.trim()
			} : null;
			session.snapshot = {
				status: root === null ? "idle" : "connecting",
				binding: session.binding,
				observation: null
			};
			const id = pageId(caller);
			publish(session, id);
			if (root !== null && runId === void 0) {
				const cancel = () => controller.abort();
				signal?.addEventListener("abort", cancel, { once: true });
				if (signal?.aborted) cancel();
				try {
					const observation = await observe(root.trim(), controller.signal);
					if (disposed || controller.signal.aborted || session.controller !== controller) return session.snapshot;
					const discovered = observation.status?.runId;
					if (!discovered) session.snapshot = {
						status: "idle",
						binding: null,
						observation: null
					};
					else {
						session.binding = {
							root: root.trim(),
							runId: discovered
						};
						accept(session, session.binding, observation);
						session.timer = setTimeout(() => void refresh(session, id), 1e3);
						session.timer.unref?.();
					}
				} catch (error) {
					if (!controller.signal.aborted && session.controller === controller) session.snapshot = {
						status: "unavailable",
						binding: null,
						observation: null,
						error: String(error)
					};
				} finally {
					signal?.removeEventListener("abort", cancel);
					if (controller.signal.aborted && session.controller === controller) session.snapshot = {
						status: "idle",
						binding: null,
						observation: null
					};
				}
				if (!disposed && session.controller === controller) publish(session, id);
				return session.snapshot;
			}
			refresh(session, id);
			return session.snapshot;
		}
	});
	const provider = api.registerProvider({
		providerId: `view-observer:${ctx.fiber.uid}`,
		sourceId: "view-backend",
		realm: "host",
		module: BACKEND_MODULE$1,
		tools
	});
	ctx.provide("viewStatus", status);
	ctx.provide("viewCapabilities", {
		ready: true,
		supportsPage: false
	});
	ctx.effect(() => async () => {
		disposed = true;
		stopSession(ordinary);
		for (const session of pages.values()) stopSession(session);
		pages.clear();
		removeDisconnect();
		unregister();
		await provider.revoke("View observer disposed");
	});
}
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-77XNWV55.mjs
function workspaceDiagnosticRecord(value) {
	return value && typeof value === "object" ? value : {};
}
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-6DHQLH3S.mjs
function safeClone(value) {
	try {
		return cloneWorkspaceValue(value);
	} catch {
		return null;
	}
}
function workspaceToolValue(value) {
	return {
		ok: true,
		value: safeClone(value)
	};
}
function toolFailureError$1(failure) {
	const detail = workspaceDiagnosticRecord(failure?.detail);
	const code = [detail?.code, detail?.remoteCode].find((candidate) => typeof candidate === "string" && candidate.startsWith("view-"));
	const payload = detail?.payload ?? detail?.detail;
	const diagnostic = (typeof failure?.hint === "string" && failure.hint.trim() !== "" ? failure.hint : void 0) ?? (typeof failure?.expected === "string" && failure.expected.trim() !== "" ? failure.expected : void 0) ?? (failure === void 0 || failure === null ? void 0 : String(failure));
	if (typeof code === "string") return workspaceError(code, typeof detail.expected === "string" ? detail.expected : failure.expected, typeof detail.hint === "string" ? detail.hint : diagnostic, {
		failure: safeClone(failure) ?? { failure },
		...payload && typeof payload === "object" ? { cause: payload } : {}
	});
	return workspaceError("view-workspace-provider-failed", typeof failure?.expected === "string" ? failure.expected : diagnostic, diagnostic, { failure: safeClone(failure) ?? { failure } });
}
async function runWorkspaceToolApi(api, { operation, args, clientId, token, requestId, caller, signal, providerId, generation, sourceId = "view-backend", apiVersion = VIEW_WORKSPACE_API_VERSION }) {
	const terminal = await api.run(operation, {
		apiVersion,
		operation,
		...args,
		args,
		clientId,
		token,
		requestId
	}, {
		sourceId,
		providerId,
		generation,
		caller,
		signal
	}).terminal;
	if (terminal.outcome === "failed") throw toolFailureError$1(terminal.failure);
	const result = workspaceDiagnosticRecord(terminal.result);
	if (result.ok === false) {
		const error = workspaceDiagnosticRecord(result.error);
		throw workspaceError(typeof error.code === "string" ? error.code : "view-workspace-provider-failed", typeof error.expected === "string" ? error.expected : void 0, typeof error.hint === "string" ? error.hint : void 0, workspaceDiagnosticRecord(error.detail));
	}
	return terminal.result;
}
function defineWorkspaceOperations(operations) {
	return Object.freeze(operations.map((operation) => Object.freeze({
		path: operation.id.split("."),
		title: operation.id,
		summary: `View workspace operation ${operation.id}.`,
		...operation
	})));
}
function createWorkspaceToolContributions(workspace, operations) {
	const schema = {
		parse(value) {
			return value !== null && typeof value === "object" && !Array.isArray(value) ? {
				ok: true,
				value
			} : {
				ok: false,
				error: "workspace API arguments must be an object"
			};
		},
		describe: "JSON object accepted by the View workspace operation."
	};
	return operations.map((description) => defineTool({
		id: description.id,
		path: description.path,
		title: description.title,
		summary: description.summary,
		realm: "host",
		argsSchema: schema,
		resultSchema: toolJsonSchema({}),
		inputSchema: { type: "object" },
		outputSchema: {},
		evidence: []
	}, async (input, context) => {
		const envelope = input;
		const direct = context.caller?.kind === "cli" && context.caller.sourceId === "devkit-backend-client" && envelope.apiVersion === void 0;
		try {
			return workspaceToolValue(await workspace.call(direct ? createWorkspaceRequest(description.operation ?? description.id, input, {
				clientId: context.caller.sourceId,
				token: workspace.accessToken,
				requestId: envelope.requestId
			}) : {
				apiVersion: VIEW_WORKSPACE_API_VERSION,
				operation: description.operation ?? description.id,
				clientId: envelope.clientId,
				requestId: envelope.requestId,
				args: envelope.args,
				...envelope.token === void 0 ? {} : { token: envelope.token }
			}, {
				signal: context.signal,
				caller: context.caller
			}));
		} catch (error) {
			if (error instanceof ViewWorkspaceError) return {
				ok: false,
				error: {
					code: error.code,
					expected: error.expected,
					hint: error.hint,
					detail: safeClone(error.detail)
				}
			};
			throw error;
		}
	}));
}
var VIEW_WORKSPACE_TARGET_RECOVERY_CODES = Object.freeze([
	"view-workspace-page-lost",
	"view-workspace-session-closed",
	"view-workspace-target-mismatch",
	"view-workspace-bootstrap-failed"
]);
var WORKSPACE_FAILURE_CODE_PATTERN = /(?:view|engine)-workspace-(?:page-lost|session-closed|target-mismatch|bootstrap-failed)/;
function normalizeWorkspaceFailureCode(candidate) {
	if (typeof candidate !== "string" || candidate.length === 0) return void 0;
	const match = candidate.match(/(?:view|engine)-workspace-[a-z0-9-]+/);
	if (!match) return void 0;
	return match[0].replace("engine-workspace-", "view-workspace-");
}
function collectFailureStrings(value, strings = [], depth = 0) {
	if (depth > 4 || value === void 0 || value === null) return strings;
	if (typeof value === "string") {
		strings.push(value);
		return strings;
	}
	if (typeof value !== "object") return strings;
	if (Array.isArray(value)) {
		for (const entry of value) collectFailureStrings(entry, strings, depth + 1);
		return strings;
	}
	const record = workspaceDiagnosticRecord(value);
	for (const key of [
		"code",
		"expected",
		"hint",
		"message",
		"remoteCode"
	]) collectFailureStrings(record[key], strings, depth + 1);
	collectFailureStrings(record.detail, strings, depth + 1);
	collectFailureStrings(record.payload, strings, depth + 1);
	collectFailureStrings(record.failure, strings, depth + 1);
	return strings;
}
function resolveWorkspaceFailureCode(value) {
	if (!value || typeof value !== "object") return "view-workspace-provider-failed";
	const failure = workspaceDiagnosticRecord(value);
	const detail = workspaceDiagnosticRecord(failure.detail);
	if (failure.code === "tool-invalid-args") return "view-workspace-invalid-args";
	if (failure.code === "tool-domain-failed" && typeof detail.code === "string" && detail.code.startsWith("view-")) return detail.code;
	const candidates = collectFailureStrings(failure);
	for (const candidate of candidates) {
		const normalized = normalizeWorkspaceFailureCode(candidate);
		if (normalized !== void 0) return normalized;
	}
	for (const candidate of candidates) if (WORKSPACE_FAILURE_CODE_PATTERN.test(candidate)) {
		const match = candidate.match(WORKSPACE_FAILURE_CODE_PATTERN);
		if (match) return match[0].replace("engine-workspace-", "view-workspace-");
	}
	if (typeof detail.code === "string" && detail.code.startsWith("pack-")) return detail.code;
	return "view-workspace-provider-failed";
}
function diagnosticCandidate(value) {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}
function pickWorkspaceDiagnostic(candidates, { allowOpaque = true } = {}) {
	const texts = candidates.map(diagnosticCandidate).filter((value) => value !== void 0);
	const real = texts.filter((value) => !isOpaqueWorkspaceDiagnostic(value));
	if (real.length > 0) return real[0];
	return allowOpaque ? texts[0] : void 0;
}
function resolveWorkspaceFailure(value) {
	const failure = workspaceDiagnosticRecord(value);
	const failureDetail = workspaceDiagnosticRecord(failure.detail);
	const code = resolveWorkspaceFailureCode(value);
	if (!value || typeof value !== "object") return {
		code,
		expected: void 0,
		hint: value === void 0 || value === null ? void 0 : String(value),
		detail: { failure: value }
	};
	const payload = failureDetail.payload;
	const nested = payload !== null && typeof payload === "object" ? workspaceDiagnosticRecord(payload) : void 0;
	const nestedDetail = nested?.detail !== null && typeof nested?.detail === "object" ? workspaceDiagnosticRecord(nested.detail) : void 0;
	const expected = pickWorkspaceDiagnostic([
		nested?.expected,
		nestedDetail?.expected,
		failureDetail.expected,
		failure.expected
	], { allowOpaque: false });
	return {
		code,
		expected,
		hint: pickWorkspaceDiagnostic([
			nested?.hint,
			nested?.message,
			nestedDetail?.hint,
			nestedDetail?.message,
			failure.hint,
			failureDetail.hint,
			failure.message,
			expected
		]),
		detail: {
			failure,
			...nested === void 0 ? {} : { cause: nested }
		}
	};
}
function isWorkspaceTargetRecoveryCode(code) {
	return typeof code === "string" && VIEW_WORKSPACE_TARGET_RECOVERY_CODES.includes(code);
}
function resolveWorkspaceReopenRoot(snapshot, explicitRoot) {
	const candidate = typeof explicitRoot === "string" && explicitRoot.trim() !== "" ? explicitRoot.trim() : typeof snapshot?.project?.root === "string" ? snapshot.project.root.trim() : "";
	if (!candidate) throw workspaceError("view-workspace-reopen-unavailable", "a known project root to reopen", "Open the project from the View owner process before reconnecting.", {});
	return candidate;
}
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-PNHVUYYP.mjs
function isPresentationOperation(operation) {
	return operation.startsWith("presentation.") && Object.hasOwn(VIEW_WORKSPACE_CORE_OPERATION_EFFECTS, operation);
}
var TOPIC = "forgeax.view.presentation.request";
var REPLY = "forgeax.view.presentation.reply";
function failure(code, expected, hint) {
	return workspaceError(code, expected, hint);
}
var PANEL_DOCK_LOCATIONS = /* @__PURE__ */ new Set([
	"grid",
	"floating",
	"popout",
	"edge"
]);
function serializePresentation(input) {
	const invalid = () => {
		throw failure("view-presentation-invalid", "a committed View presentation snapshot with valid field types", "Reconnect the View frontend.");
	};
	const text = (value) => typeof value === "string" ? value.slice(0, 512) : invalid();
	const identity = (value) => typeof value === "string" && value.length > 0 && value.length <= 256 ? value : invalid();
	const flag = (value) => typeof value === "boolean" ? value : invalid();
	const placement = (value) => {
		if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
		const row = value;
		if (row.kind === "unmounted" && Object.keys(row).every((field) => field === "kind")) return { kind: "unmounted" };
		if (row.kind === "shell-bottom" && Object.keys(row).every((field) => ["kind", "location"].includes(field)) && typeof row.location === "string" && PANEL_DOCK_LOCATIONS.has(row.location)) return {
			kind: "shell-bottom",
			location: row.location
		};
		if (row.kind === "page" && Object.keys(row).every((field) => [
			"kind",
			"pageId",
			"pageType",
			"location"
		].includes(field)) && typeof row.pageId === "string" && row.pageId.length > 0 && row.pageId.length <= 256 && typeof row.pageType === "string" && row.pageType.length > 0 && row.pageType.length <= 256 && typeof row.location === "string" && PANEL_DOCK_LOCATIONS.has(row.location)) return {
			kind: "page",
			pageId: row.pageId,
			pageType: row.pageType,
			location: row.location
		};
		return invalid();
	};
	const resource = (value) => {
		if (value === void 0) return;
		if (value && "asset" in value) return { asset: {
			guid: identity(value.asset?.guid),
			kind: identity(value.asset?.kind)
		} };
		if (value && "file" in value && typeof value.file?.path === "string" && value.file.path.length > 0 && value.file.path.length <= 4096) return { file: {
			projectId: identity(value.file.projectId),
			path: value.file.path,
			extension: identity(value.file.extension)
		} };
		return invalid();
	};
	if (!input || !["mounted", "project-restoring"].includes(input.shellState) || !Array.isArray(input.pages) || !Array.isArray(input.pageTypes) || !Array.isArray(input.panels) || !input.appearance) throw failure("view-presentation-invalid", "a committed View presentation snapshot", "Reconnect the View frontend.");
	return {
		shellState: input.shellState,
		activePageId: input.activePageId === null ? null : identity(input.activePageId),
		pages: input.pages.slice(0, 64).map((row) => ({
			id: identity(row?.id),
			typeId: identity(row?.typeId),
			title: text(row?.title),
			closable: flag(row?.closable),
			...row?.resource === void 0 ? {} : { resource: resource(row.resource) }
		})),
		pageTypes: input.pageTypes.slice(0, 64).map((row) => ({
			typeId: identity(row?.typeId),
			title: text(row?.title),
			openable: flag(row?.openable)
		})),
		panels: input.panels.slice(0, 128).map((row) => ({
			id: identity(row?.id),
			title: text(row?.title),
			mounted: flag(row?.mounted),
			visible: flag(row?.visible),
			active: flag(row?.active),
			placement: placement(row?.placement)
		})),
		hasMorePages: flag(input.hasMorePages) || input.pages.length > 64,
		hasMorePageTypes: flag(input.hasMorePageTypes) || input.pageTypes.length > 64,
		hasMorePanels: flag(input.hasMorePanels) || input.panels.length > 128,
		appearance: {
			theme: text(input.appearance.theme),
			preference: text(input.appearance.preference),
			language: text(input.appearance.language)
		}
	};
}
function createPresentationRelay(transport, resolveConnection, timeoutMs = 3e3) {
	const pending = /* @__PURE__ */ new Map();
	let disposed = false;
	const unregister = transport.register(REPLY, ({ payload, caller }) => {
		const request = pending.get(payload?.requestId);
		if (!request || request.connectionId !== caller.connectionId) return { accepted: false };
		if (payload.failure) request.finish(void 0, failure(payload.failure.code, payload.failure.expected, payload.failure.hint));
		else try {
			request.finish(serializePresentation(payload.snapshot));
		} catch (error) {
			request.finish(void 0, error);
		}
		return { accepted: true };
	});
	const disconnect = transport.onClientDisconnect((caller) => {
		for (const request of pending.values()) if (request.connectionId === caller.connectionId) request.finish(void 0, failure("view-presentation-disconnected", "the selected View document to remain connected", "Read pages.list and choose a live document."));
	});
	return {
		call(operation, args, caller, signal) {
			if (disposed) throw failure("view-presentation-unavailable", "a live View presentation provider", "Reconnect View.");
			if (pending.size >= 64) throw failure("view-presentation-busy", "fewer than 64 pending presentation requests", "Wait for current requests to complete.");
			const connectionId = resolveConnection(caller, args.connectionId);
			const requestId = crypto.randomUUID();
			const { connectionId: _connection, ...input } = args;
			return new Promise((resolve, reject) => {
				const cancel = () => finish(void 0, failure("view-presentation-cancelled", "the presentation request to remain active", "Read presentation.get before retrying a write; it may already have applied."));
				const timer = setTimeout(() => finish(void 0, failure("view-presentation-timeout", "the selected View document to answer the presentation request", "Read presentation.get after reconnecting; never replay writes automatically.")), timeoutMs);
				const finish = (snapshot, error) => {
					if (!pending.delete(requestId)) return;
					clearTimeout(timer);
					signal?.removeEventListener("abort", cancel);
					if (error) {
						transport.publish(TOPIC, {
							requestId,
							operation,
							args: input,
							cancelled: true
						}, { connectionId });
						reject(error);
					} else resolve({
						...snapshot,
						connectionId
					});
				};
				pending.set(requestId, {
					connectionId,
					finish
				});
				signal?.addEventListener("abort", cancel, { once: true });
				if (signal?.aborted) {
					cancel();
					return;
				}
				transport.publish(TOPIC, {
					requestId,
					operation,
					args: input
				}, { connectionId });
			});
		},
		dispose() {
			disposed = true;
			for (const request of pending.values()) request.finish(void 0, failure("view-presentation-unavailable", "a live View presentation provider", "Reconnect View."));
			unregister();
			disconnect();
		}
	};
}
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-DVYXLWLV.mjs
function createRequestSharing() {
	const flights = /* @__PURE__ */ new Map();
	return {
		fence() {
			flights.clear();
		},
		read(key, execute, signal) {
			if (signal?.aborted) return Promise.reject(signal.reason);
			let flight = flights.get(key);
			if (!flight) {
				const controller = new AbortController();
				flight = {
					controller,
					promise: Promise.resolve().then(() => execute(controller.signal)),
					readers: 0
				};
				flights.set(key, flight);
				const owned2 = flight;
				owned2.promise.finally(() => {
					if (flights.get(key) === owned2) flights.delete(key);
				}).catch(() => {});
			}
			const owned = flight;
			owned.readers++;
			return new Promise((resolve, reject) => {
				let released = false;
				const release = (cancel = false) => {
					if (released) return;
					released = true;
					signal?.removeEventListener("abort", abort);
					if (--owned.readers === 0) {
						if (flights.get(key) === owned) flights.delete(key);
						if (cancel) owned.controller.abort(signal?.reason);
					}
				};
				const abort = () => {
					release(true);
					reject(signal?.reason);
				};
				signal?.addEventListener("abort", abort, { once: true });
				owned.promise.then((value) => {
					if (released) return;
					release();
					resolve(value);
				}, (error) => {
					if (released) return;
					release();
					reject(error);
				});
			});
		}
	};
}
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-OXWSFYJ7.mjs
var LOG_PREFIX$1 = "[forgeax.view.trace]";
var MAX_EVENTS = 6e3;
var MAX_SESSION_EVENTS = 2e4;
var enabled = false;
var bootAt = 0;
var events = [];
var counters = /* @__PURE__ */ new Map();
var activeCaptureSession = null;
function now() {
	return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}
function relT() {
	return Math.round((now() - bootAt) * 100) / 100;
}
function bump(name, delta = 1) {
	counters.set(name, (counters.get(name) ?? 0) + delta);
}
function sessionBump(name, delta = 1) {
	if (!activeCaptureSession) return;
	const map = activeCaptureSession.counters;
	map.set(name, (map.get(name) ?? 0) + delta);
}
function pushEvent(entry, { sessionOnly = false } = {}) {
	if (!enabled) return;
	if (activeCaptureSession) {
		activeCaptureSession.events.push(entry);
		if (activeCaptureSession.events.length > MAX_SESSION_EVENTS) {
			activeCaptureSession.events.splice(0, activeCaptureSession.events.length - MAX_SESSION_EVENTS);
			sessionBump("session.events-truncated");
		}
	}
	if (!sessionOnly) {
		events.push(entry);
		if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
	}
}
function traceView(phase, event, data = {}) {
	if (!enabled) return;
	const entry = {
		t: relT(),
		phase,
		event,
		...data
	};
	bump(`${phase}.${event}`);
	sessionBump(`${phase}.${event}`);
	pushEvent(entry);
	if ((activeCaptureSession || phase === "session" || phase === "boot") && typeof console !== "undefined" && typeof console.debug === "function") console.debug(LOG_PREFIX$1, phase, event, data);
}
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-BVA4I7MF.mjs
var LOG_PREFIX = "[forgeax.view.resource-open]";
var SCENE_ASSET_KIND = "scene";
var TYPE_PREVIEW_KINDS = Object.freeze([
	"material",
	"mesh",
	"texture",
	"equirect"
]);
function summarizeResourceAsset(asset) {
	if (!asset || typeof asset !== "object") return null;
	return {
		guid: typeof asset.guid === "string" ? asset.guid : null,
		kind: typeof asset.kind === "string" ? asset.kind : null
	};
}
function isSceneWorkspaceAsset(asset) {
	return asset?.kind === SCENE_ASSET_KIND;
}
function isTypePreviewAsset(asset) {
	return asset != null && TYPE_PREVIEW_KINDS.includes(asset.kind);
}
function selectSceneWorkspacePreview(previews, preferredTargetId) {
	const list = (Array.isArray(previews) ? previews : []).filter((entry) => entry?.target?.targetId != null);
	if (preferredTargetId != null && preferredTargetId !== "") {
		const preferred = list.find((entry) => String(entry.target.targetId) === String(preferredTargetId));
		if (preferred && (!preferred.asset || isSceneWorkspaceAsset(preferred.asset))) return preferred;
	}
	const scenes = list.filter((entry) => isSceneWorkspaceAsset(entry.asset));
	if (scenes.length === 1) return scenes[0];
	const sceneWorlds = list.filter((entry) => !entry.asset);
	return sceneWorlds.length === 1 ? sceneWorlds[0] : void 0;
}
function sceneTargetIds(previews, scenePreview) {
	const ids = /* @__PURE__ */ new Set();
	const add = (entry) => {
		if (entry?.target?.targetId == null) return;
		ids.add(String(entry.target.targetId));
	};
	add(scenePreview);
	for (const entry of Array.isArray(previews) ? previews : []) if (isSceneWorkspaceAsset(entry?.asset)) add(entry);
	return ids;
}
function logResourceOpen(event, data = {}, { level = "info" } = {}) {
	const logger = typeof console === "undefined" ? void 0 : console[level];
	if (typeof logger === "function") logger(LOG_PREFIX, event, data);
	try {
		traceView("resource-open", event, data);
	} catch {}
}
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-X7B2B6J2.mjs
var EXT_KIND = Object.freeze({
	".png": {
		kind: "image",
		mime: "image/png"
	},
	".jpg": {
		kind: "image",
		mime: "image/jpeg"
	},
	".jpeg": {
		kind: "image",
		mime: "image/jpeg"
	},
	".gif": {
		kind: "image",
		mime: "image/gif"
	},
	".webp": {
		kind: "image",
		mime: "image/webp"
	},
	".avif": {
		kind: "image",
		mime: "image/avif"
	},
	".bmp": {
		kind: "image",
		mime: "image/bmp"
	},
	".ico": {
		kind: "image",
		mime: "image/x-icon"
	},
	".svg": {
		kind: "image",
		mime: "image/svg+xml"
	},
	".mp3": {
		kind: "audio",
		mime: "audio/mpeg"
	},
	".wav": {
		kind: "audio",
		mime: "audio/wav"
	},
	".ogg": {
		kind: "audio",
		mime: "audio/ogg"
	},
	".m4a": {
		kind: "audio",
		mime: "audio/mp4"
	},
	".flac": {
		kind: "audio",
		mime: "audio/flac"
	},
	".aac": {
		kind: "audio",
		mime: "audio/aac"
	},
	".mp4": {
		kind: "video",
		mime: "video/mp4"
	},
	".webm": {
		kind: "video",
		mime: "video/webm"
	},
	".mov": {
		kind: "video",
		mime: "video/quicktime"
	},
	".glb": {
		kind: "model",
		mime: "model/gltf-binary"
	},
	".gltf": {
		kind: "model",
		mime: "model/gltf+json"
	},
	".fbx": {
		kind: "model",
		mime: "application/octet-stream"
	},
	".ttf": {
		kind: "binary",
		mime: "font/ttf"
	},
	".otf": {
		kind: "binary",
		mime: "font/otf"
	},
	".woff": {
		kind: "binary",
		mime: "font/woff"
	},
	".woff2": {
		kind: "binary",
		mime: "font/woff2"
	}
});
var MAX_BINARY_PREVIEW_BYTES = 10485760;
var BINARY_PREVIEW_KINDS = /* @__PURE__ */ new Set([
	"image",
	"audio",
	"video",
	"binary"
]);
function classifyFile(path) {
	return EXT_KIND[extname(path).toLowerCase()] ?? {
		kind: "text",
		mime: "text/plain; charset=utf-8"
	};
}
function resolveProjectFilePath(root, input) {
	if (typeof root !== "string" || root.trim() === "") return null;
	if (typeof input !== "string" || input.length === 0 || input.includes("\0")) return null;
	const rootAbs = resolve(root);
	const abs = isAbsolute(input) ? resolve(input) : resolve(rootAbs, input);
	const rel = relative(rootAbs, abs);
	if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
	const normalized = rel.split(/[/\\]/).join("/");
	if (normalized === ".forgeax/ddc" || normalized.startsWith(".forgeax/ddc/")) return null;
	return {
		abs,
		rel: normalized
	};
}
async function readFilePreview(absPath, rel) {
	let info;
	try {
		info = await stat(absPath);
	} catch {
		throw new Error("not found");
	}
	if (info.isDirectory()) throw new Error("is a directory");
	const ext = extname(rel).toLowerCase();
	const { kind, mime } = classifyFile(rel);
	const base = {
		path: rel,
		kind,
		mime,
		size: info.size,
		mtime: info.mtimeMs
	};
	if (kind === "text") {
		const content = await readFile(absPath, "utf8");
		return {
			...base,
			content
		};
	}
	if (kind === "image" && ext === ".svg") {
		const content = await readFile(absPath, "utf8");
		return {
			...base,
			content
		};
	}
	if (BINARY_PREVIEW_KINDS.has(kind)) {
		if (info.size > MAX_BINARY_PREVIEW_BYTES) return base;
		const buffer = await readFile(absPath);
		return {
			...base,
			dataUrl: `data:${mime};base64,${buffer.toString("base64")}`
		};
	}
	return base;
}
async function readWorkspaceFilePreview(workspace, payload = {}) {
	const root = workspace?.project?.root;
	if (typeof root !== "string" || root.trim() === "") throw workspaceError("view-workspace-project-closed", "an open project", "Open a project before previewing source files.");
	const resolved = resolveProjectFilePath(root, payload?.path);
	if (!resolved) throw workspaceError("view-workspace-invalid-args", "path to be a file inside the open project", "Provide a project-relative or in-project absolute path.", { field: "path" });
	try {
		const actualRoot = await realpath(root);
		const actualFile = await realpath(resolved.abs);
		const inside = relative(actualRoot, actualFile);
		if (!inside || inside.startsWith("..") || isAbsolute(inside)) throw new Error("outside project");
		return await readFilePreview(resolved.abs, resolved.rel);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.startsWith("is a directory")) throw workspaceError("view-workspace-invalid-args", "a file path", message, { path: resolved.rel });
		if (message === "outside project") throw workspaceError("view-workspace-invalid-args", "path to remain inside the open project", "Use a file inside this project.", { path: resolved.rel });
		throw workspaceError("view-workspace-file-not-found", "the file to exist in the open project", "Refresh the content browser and retry.", { path: resolved.rel });
	}
}
async function listWorkspaceHtmlFiles(workspace) {
	const root = workspace?.project?.root;
	if (typeof root !== "string" || !root) throw workspaceError("view-workspace-project-closed", "an open project", "Open a project before listing HTML files.");
	const files = [];
	const queue = [...workspace?.project?.assetRoots ?? []];
	let visited = 0;
	const directories = /* @__PURE__ */ new Set();
	while (queue.length && visited < 5e3 && files.length < 500) {
		const directory = queue.shift();
		if (directories.has(directory)) continue;
		directories.add(directory);
		let entries;
		try {
			const path = resolve(root, directory);
			if (await realpath(path) !== path) continue;
			entries = await readdir(path, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (++visited > 5e3) break;
			if (entry.name.startsWith(".") || [
				"node_modules",
				"dist",
				"build"
			].includes(entry.name)) continue;
			const path = directory ? `${directory}/${entry.name}` : entry.name;
			if (entry.isDirectory()) queue.push(path);
			else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) files.push(path);
			if (files.length >= 500) break;
		}
	}
	return {
		files,
		hasMore: queue.length > 0 || visited >= 5e3 || files.length >= 500
	};
}
var ENGINE_SOURCE = "engine-workspace";
var UI_OPERATIONS = Object.freeze({
	"summary.get": (workspace) => workspace.summary(),
	"pages.list": (workspace) => workspace.pages(),
	"pack.reveal": (workspace, args, context) => workspace.revealPack({
		projectId: requireWorkspaceString(args.projectId, "projectId"),
		sourcePath: requireWorkspaceString(args.sourcePath, "sourcePath"),
		revision: requireWorkspaceString(args.revision, "revision"),
		...args.packageId === void 0 ? {} : { packageId: requireWorkspaceString(args.packageId, "packageId") },
		...args.connectionId === void 0 ? {} : { connectionId: requireWorkspaceString(args.connectionId, "connectionId") }
	}, context.signal),
	"target.select": (workspace, args) => workspace.selectTarget(args),
	"tabs.get": (workspace) => workspace.snapshot(),
	"tabs.select": (workspace, args) => workspace.selectTab(args),
	"scene.select": (workspace, args, context) => workspace.selectSceneEntity(args, context),
	"scene.pick": (workspace, args, context) => workspace.pickSceneEntity(args, context),
	"scene.clear": (workspace, args, context) => workspace.clearSceneSelection(args, context)
});
var PAGE_OPERATIONS = /* @__PURE__ */ new Set([
	"tabs.get",
	"tabs.select",
	"target.select",
	"scene.select",
	"scene.pick",
	"scene.clear",
	"asset.open",
	"preview.close",
	"play.start",
	"play.ready",
	"play.stop"
]);
var ViewWorkspaceBroker = class _ViewWorkspaceBroker {
	resourceFlights = createRequestSharing();
	resourceLifetime = new AbortController();
	resourceBrowserGeneration = -1;
	resourceCatalogEpoch = -1;
	resourceRequests = /* @__PURE__ */ new Map();
	closingPreviews = /* @__PURE__ */ new Set();
	constructor({ engine, engineForCaller, projectIntent, toolApi, display = () => void 0, accessToken = randomUUID(), authorize, packSources } = {}, caller) {
		this.engine = engine;
		this.engineForCaller = engineForCaller;
		this.projectIntent = projectIntent;
		this.caller = caller;
		this.toolApi = toolApi;
		this.display = display;
		this.accessToken = accessToken;
		this.authorize = authorize;
		this.packSources = packSources;
		this.selectedTabId = VIEW_WORKSPACE_TAB_ID;
		this.targetBinding = "scene";
		this.sceneTargetId = void 0;
		this.playOwner = void 0;
		this.revision = 0;
		this.listeners = /* @__PURE__ */ new Set();
		this.assets = null;
		this.inspection = null;
		this.openRequest = null;
		this.openRequestSequence = 0;
		this.resourceOpens = /* @__PURE__ */ new Map();
		this.sceneSelection = null;
		this.selectionAbort?.abort();
		this.previewProjection = null;
		this.projectOwner = void 0;
		this.previewOwner = void 0;
		this.workspaceTargetLost = false;
		this.catalogEpoch = -1;
		this.thumbnailEpoch = -1;
		this.disposing = false;
		this.publishFingerprint = "";
		this.pageSessions = /* @__PURE__ */ new Map();
		this.pendingReveals = /* @__PURE__ */ new Map();
	}
	get project() {
		return this.engine?.project?.project ?? null;
	}
	get projectTarget() {
		return this.engine?.project?.target ?? null;
	}
	get preview() {
		this.syncBindings();
		return this.previewProjection;
	}
	previews() {
		return this.engine?.previews ?? (this.engine?.preview ? [this.engine.preview] : []);
	}
	classifiedPreviews() {
		return this.previews().map((preview) => ({
			target: preview.target,
			asset: this.hydrateAsset(preview.asset)
		}));
	}
	scenePreview() {
		const live = this.previews();
		const selected = selectSceneWorkspacePreview(this.classifiedPreviews(), this.sceneTargetId);
		if (!selected) return void 0;
		return live.find((preview) => String(preview.target.targetId) === String(selected.target.targetId));
	}
	boundTarget() {
		if (this.targetBinding === "play") {
			const play = this.engine?.play;
			return play?.phase === "running" ? play : void 0;
		}
		return this.previews().find((preview) => preview.target.targetId === this.previewTargetId) ?? this.scenePreview();
	}
	hydrateAsset(asset) {
		if (!asset?.guid) return asset ?? null;
		if (asset.kind) return asset;
		const catalog = Array.isArray(this.assets) ? this.assets.find((entry) => entry.guid === asset.guid) : void 0;
		if (!catalog?.kind) return asset;
		return {
			...asset,
			kind: catalog.kind,
			name: asset.name ?? catalog.name
		};
	}
	selectTarget({ targetId } = {}) {
		if (targetId === this.engine?.play?.target.targetId) this.targetBinding = "play";
		else {
			const preview = this.previews().find((entry) => entry.target.targetId === targetId);
			if (!preview) throw workspaceError("view-workspace-target-mismatch", "An existing preview or Play target", "Refresh tabs.get.");
			this.targetBinding = "scene";
			this.previewTargetId = targetId;
			if (isSceneWorkspaceAsset(this.hydrateAsset(preview.asset))) this.sceneTargetId = String(targetId);
		}
		this.changed();
		return this.snapshot();
	}
	syncBindings() {
		const browserGeneration = this.engine?.project?.browserGeneration ?? 0;
		const replaced = this.projectOwner !== this.engine?.project || this.resourceBrowserGeneration !== browserGeneration;
		if (replaced || this.resourceCatalogEpoch !== this.catalogEpoch) {
			if (replaced && this.resourceBrowserGeneration !== -1) {
				this.resourceOpens.clear();
				this.openRequest = null;
			}
			this.resourceLifetime.abort();
			this.resourceLifetime = new AbortController();
			this.resourceFlights.fence();
			this.resourceRequests.clear();
			this.resourceBrowserGeneration = browserGeneration;
			this.resourceCatalogEpoch = this.catalogEpoch;
		}
		if (this.playOwner !== this.engine?.play) {
			this.playOwner = this.engine?.play;
			this.targetBinding = this.playOwner ? "play" : "scene";
			if (!this.playOwner) this.previewTargetId = this.scenePreview()?.target.targetId;
		}
		if (this.projectOwner !== this.engine?.project) {
			this.projectOwner = this.engine?.project;
			this.assets = null;
			this.inspection = null;
			this.openRequest = null;
			this.openRequestSequence = 0;
			this.resourceOpens = /* @__PURE__ */ new Map();
			this.sceneTargetId = void 0;
			this.sceneSelection = null;
			this.selectionAbort?.abort();
		}
		if (this.previewOwner !== this.boundTarget()) {
			this.previewOwner = this.boundTarget();
			this.sceneSelection = null;
			this.selectionAbort?.abort();
			this.previewProjection = this.previewOwner ? {
				target: this.previewOwner.target,
				asset: this.previewOwner.asset,
				presentation: this.previewOwner.presentation,
				assetBinding: this.previewOwner.assetBinding
			} : null;
		}
	}
	summary() {
		const project = this.project;
		const previews = this.previews();
		const projectTarget = this.projectTarget && this.engine?.preview?.target.targetId === this.projectTarget.targetId ? this.engine.preview.target : this.projectTarget;
		const active = [...projectTarget ? [{
			target: projectTarget,
			role: "project"
		}] : [], ...this.engine?.play ? [{
			target: this.engine.play.target,
			role: "play"
		}] : []];
		const targets = [...active, ...previews.slice(0, Math.max(0, 16 - active.length)).map((preview) => ({
			target: preview.target,
			role: "preview"
		}))];
		return {
			revision: this.revision,
			project: project ? {
				id: project.id,
				root: project.root,
				name: project.name
			} : null,
			projectPhase: this.engine?.project?.phase ?? null,
			browserGeneration: this.engine?.project?.browserGeneration ?? null,
			targets: targets.map(({ target, role }) => ({
				targetId: target.targetId,
				...target.generation === void 0 ? {} : { generation: target.generation },
				role
			})),
			hasMoreTargets: active.length + previews.length > 16
		};
	}
	pages() {
		const entries = this.pageConnections();
		return {
			pages: entries.slice(0, 16).map(([connectionId, page]) => ({
				connectionId,
				...page.broker.summary()
			})),
			hasMorePages: entries.length > 16
		};
	}
	pageConnections() {
		return [...this.pageSessions.entries()].filter(([connectionId, page]) => page.broker.caller?.connectionId === connectionId);
	}
	snapshot() {
		this.syncBindings();
		const display = this.display?.();
		return serializeWorkspaceState({
			revision: this.revision,
			selectedTabId: this.selectedTabId,
			tabs: [{
				tabId: VIEW_DISPLAY_TAB_ID,
				kind: "display",
				selected: this.selectedTabId === VIEW_DISPLAY_TAB_ID,
				state: display?.state,
				run: display?.occupancy?.run,
				target: display?.occupancy?.target,
				targetId: display?.occupancy?.targetId
			}, {
				tabId: VIEW_WORKSPACE_TAB_ID,
				kind: "workspace",
				selected: this.selectedTabId === VIEW_WORKSPACE_TAB_ID,
				state: this.previewProjection ? "previewing" : this.project ? "project-open" : "empty",
				...this.previewProjection?.target ?? this.projectTarget ? { target: this.previewProjection?.target ?? this.projectTarget } : {}
			}],
			project: this.project,
			projectTarget: this.projectTarget,
			...!this.project && this.projectIntent?.() ? { projectIntent: { root: this.projectIntent() } } : {},
			...this.engine?.project?.phase === void 0 ? {} : { projectPhase: this.engine.project.phase },
			...this.engine?.project?.browserGeneration === void 0 ? {} : { browserGeneration: this.engine.project.browserGeneration },
			assets: this.assets,
			...this.catalogEpoch < 0 ? {} : { catalogEpoch: this.catalogEpoch },
			...this.thumbnailEpoch < 0 ? {} : { thumbnailEpoch: this.thumbnailEpoch },
			preview: this.previewProjection && {
				...this.previewProjection,
				target: this.boundTarget().target,
				asset: this.hydrateAsset(this.previewProjection.asset),
				assetBinding: this.boundTarget().assetBinding
			},
			scenePreview: this.scenePreview() ? {
				target: this.scenePreview().target,
				asset: this.hydrateAsset(this.scenePreview().asset),
				assetBinding: this.scenePreview().assetBinding
			} : null,
			previews: this.previews().map((preview) => ({
				target: preview.target,
				asset: this.hydrateAsset(preview.asset),
				assetBinding: preview.assetBinding
			})),
			play: this.engine?.play ? {
				target: this.engine.play.target,
				phase: this.engine.play.phase
			} : null,
			targetBinding: this.targetBinding,
			inspection: this.inspection,
			openRequest: this.openRequest,
			resourceOpens: Object.fromEntries(this.resourceOpens),
			sceneSelection: this.sceneSelection,
			workspaceTargetLost: this.workspaceTargetLost
		});
	}
	changed() {
		if (workspaceUiFingerprint(this.snapshot()) === this.publishFingerprint) return;
		this.revision += 1;
		const state = this.snapshot();
		this.publishFingerprint = workspaceUiFingerprint(state);
		for (const listener of this.listeners) try {
			listener(state);
		} catch {}
	}
	subscribe(listener) {
		this.listeners.add(listener);
		const state = this.snapshot();
		this.publishFingerprint ||= workspaceUiFingerprint(state);
		listener(state);
		return () => this.listeners.delete(listener);
	}
	capabilities() {
		const descriptions = this.toolApi?.list().filter((record) => record.callable && (record.owner.sourceId === ENGINE_SOURCE || record.descriptor.id.startsWith("view.display."))).map((record) => ({
			id: record.descriptor.id.replace(/^(engine|view)\./, ""),
			path: record.descriptor.path,
			title: record.descriptor.title,
			summary: record.descriptor.summary,
			inputSchema: record.descriptor.inputSchema,
			outputSchema: record.descriptor.outputSchema
		})) ?? [];
		const operations = [
			...Object.keys(UI_OPERATIONS),
			...this.presentation ? Object.keys(VIEW_WORKSPACE_CORE_OPERATION_EFFECTS).filter(isPresentationOperation) : [],
			...descriptions.map((item) => item.id),
			...VIEW_WORKSPACE_OPERATIONS.filter((id) => id.startsWith("plugins.") && this.toolApi?.describe(id, "view-backend").some((record) => record.callable))
		].filter((id) => VIEW_WORKSPACE_OPERATIONS.includes(id));
		return {
			...workspaceCapabilities({
				ready: !!this.engine && !this.disposing,
				headed: this.projectTarget?.headed === true,
				operations
			}),
			descriptions
		};
	}
	async authorizeRequest(request, caller) {
		if (this.disposing) throw workspaceError("view-workspace-stopping", "View bindings to remain available", "Reconnect to the backend.");
		if (request.token !== this.accessToken || this.authorize && !await this.authorize({
			clientId: request.clientId,
			operation: request.operation,
			request,
			caller
		})) throw workspaceError("view-workspace-unauthorized", "an authorized workspace connection", "Connect with the issued token.", { clientId: request.clientId });
	}
	async call(rawRequest, { signal, caller } = {}) {
		const request = assertWorkspaceRequest(rawRequest);
		if (isPresentationOperation(request.operation)) {
			await this.authorizeRequest(request, caller);
			if (!this.presentation) throw workspaceError("view-presentation-unavailable", "an installed presentation transport", "Connect the View frontend.");
			const state = await this.presentation.call(request.operation, request.args, caller, signal);
			const page2 = this.pageSessions.get(state.connectionId);
			if (!page2) throw workspaceError("view-page-gone", "the selected View document to remain connected", "Read pages.list before retrying.");
			return {
				...state,
				workspace: page2.broker.summary()
			};
		}
		if (request.operation === "pages.list" || request.operation === "pack.reveal") {
			await this.authorizeRequest(request, caller);
			return UI_OPERATIONS[request.operation](this, request.args, {
				signal,
				caller,
				clientId: request.clientId
			});
		}
		if (request.operation.startsWith("history.") && this.transport) {
			await this.authorizeRequest(request, caller);
			const id = this.resolvePageConnection(caller, request.args.connectionId);
			const page2 = this.pageSessions.get(id);
			const { connectionId: _connection, ...args } = request.args;
			return page2.broker.call({
				...request,
				args
			}, {
				signal,
				caller
			});
		}
		const page = caller?.connectionId && this.pageSessions.get(caller.connectionId);
		if (page) {
			if (caller?.connectionId !== page.broker.caller?.connectionId && this.engineForCaller?.(caller) !== page.broker.engine) throw workspaceError("view-page-gone", "the embedded document to retain its admitted Engine runtime", "Reconnect the current project document.");
			return page.broker.call(rawRequest, {
				signal,
				caller
			});
		}
		await this.authorizeRequest(request, caller);
		if (PAGE_OPERATIONS.has(request.operation) && this.pageSessions.size > 0) {
			const pages = this.pageConnections();
			if (pages.length !== 1) throw workspaceError("view-page-ambiguous", "one View page for this page operation", "Select the exact View page before retrying.");
			return pages[0][1].broker.call(request, {
				signal,
				caller
			});
		}
		const ui = UI_OPERATIONS[request.operation];
		if (ui) return ui(this, request.args, {
			signal,
			caller,
			clientId: request.clientId
		});
		if (request.operation === "project.reopen") return this.reopenProject(request.args, {
			signal,
			caller,
			clientId: request.clientId,
			token: request.token,
			requestId: request.requestId
		});
		return this.invoke(request.operation, request.args, {
			signal,
			caller,
			clientId: request.clientId,
			token: request.token,
			requestId: request.requestId
		});
	}
	async invoke(operation, args = {}, context = {}) {
		const knownAsset = operation === "asset.open" ? this.assets?.find((entry) => entry.guid === args.guid) : void 0;
		if (operation === "asset.open" && args.detailsOnly !== true && (!knownAsset || isTypePreviewAsset(knownAsset))) {
			this.syncBindings();
			if (!this.assets && this.project && this.toolApi?.describe("engine.assets.list", ENGINE_SOURCE).some((item) => item.callable)) await this.invokeDomain("assets.list", { projectId: args.projectId }, context);
			const asset = this.assets?.find((entry) => entry.guid === args.guid) ?? knownAsset;
			if (asset && isTypePreviewAsset(asset) && asset.previewable !== false) return this.openResourceAsset(asset, args, context);
		}
		if (operation !== "preview.close") return this.invokeDomain(operation, args, context);
		const id = String(args.targetId);
		this.closingPreviews.add(id);
		try {
			return await this.invokeDomain(operation, args, context);
		} finally {
			this.closingPreviews.delete(id);
		}
	}
	openResourceAsset(asset, args, context) {
		const project = this.engine?.project;
		const projectTarget = project?.target;
		if (!project || args.projectId !== project.project.id || this.workspaceTargetLost || project.failure || project.phase === "failed") return Promise.reject(workspaceError("view-workspace-project-stale", "The current project", "Refresh tabs.get."));
		if (args.targetId !== void 0 && args.targetId !== projectTarget?.targetId) return Promise.reject(workspaceError("view-workspace-target-mismatch", "The current project target", "Refresh tabs.get."));
		const suppliedTarget = [this.scenePreview()?.target ?? projectTarget, projectTarget].find((target) => target && target.targetId === (args.targetId ?? projectTarget?.targetId) && (args.targetGeneration === void 0 || target.generation === args.targetGeneration));
		if (args.targetGeneration !== void 0 && !suppliedTarget) return Promise.reject(workspaceError("view-workspace-target-mismatch", "The current project target generation", "Refresh tabs.get."));
		const lifetime = this.resourceLifetime.signal;
		const key = JSON.stringify([
			project.project.id,
			projectTarget?.targetId,
			this.resourceBrowserGeneration,
			asset.guid,
			this.catalogEpoch
		]);
		return this.resourceFlights.read(key, async (sharedSignal) => {
			const request = new AbortController();
			this.resourceRequests.get(asset.kind)?.abort();
			this.resourceRequests.set(asset.kind, request);
			const signal = AbortSignal.any([
				sharedSignal,
				lifetime,
				request.signal
			]);
			const requestId = context.requestId ?? createWorkspaceId("open");
			const current = () => !signal.aborted && !this.disposing && this.engine?.project === project;
			const started = performance.now();
			const trace = (stage, extra = {}) => logResourceOpen("timing", {
				requestId,
				stage,
				at: Date.now(),
				elapsedMs: Math.round(performance.now() - started),
				...extra
			});
			const publish = (phase, failure) => {
				this.openRequest = {
					requestId,
					sequence: ++this.openRequestSequence,
					asset,
					phase,
					...failure ? { failure } : {}
				};
				this.resourceOpens.set(asset.kind, {
					...this.resourceOpens.get(asset.kind) ?? { asset },
					pending: this.openRequest
				});
				this.changed();
			};
			try {
				signal.throwIfAborted();
				const retained = this.resourceOpens.get(asset.kind);
				let existing = [...this.previews()].reverse().find((preview2) => retained?.preview?.target.targetId === preview2.target.targetId && retained.preview.target.generation === preview2.target.generation && retained.asset.guid === asset.guid && retained.catalogEpoch === this.catalogEpoch && preview2.asset?.guid === asset.guid && !this.closingPreviews.has(preview2.target.targetId) && (!projectTarget || preview2.target.sessionId === projectTarget.sessionId));
				if (existing?.assetBinding?.publication && this.toolApi?.describe("engine.asset.inspect", ENGINE_SOURCE).some((record) => record.callable)) {
					const inspected = await this.invokeDomain("asset.inspect", {
						projectId: project.project.id,
						guid: asset.guid,
						...args.targetId === void 0 ? {} : { targetId: args.targetId },
						...args.targetGeneration === void 0 ? {} : { targetGeneration: args.targetGeneration }
					}, {
						...context,
						signal
					});
					signal.throwIfAborted();
					if (!current()) throw new DOMException("Resource open became stale", "AbortError");
					const publication = inspected.inspection?.source?.publication ?? inspected.inspection?.publication;
					const bound = existing.assetBinding?.publication;
					if (publication && (!bound || [
						"schemaVersion",
						"sourcePath",
						"sourceRevision",
						"generation",
						"digest",
						"outputSetDigest"
					].some((key2) => publication[key2] !== bound[key2]))) existing = void 0;
				}
				if (existing) {
					this.recordOpenRequest({
						requestId,
						result: { preview: {
							target: existing.target,
							asset,
							assetBinding: existing.assetBinding
						} },
						guid: asset.guid
					});
					this.changed();
					trace("reused", { targetId: existing.target.targetId });
					return this.snapshot();
				}
				publish("opening");
				trace("opening");
				trace("engine-operation-start");
				const result = await this.invokeDomain("asset.open", args, {
					...context,
					requestId,
					signal
				}, false);
				trace("engine-operation-end");
				signal.throwIfAborted();
				if (!current()) throw new DOMException("Resource open became stale", "AbortError");
				const preview = result.preview;
				if (!preview) throw workspaceError("view-preview-target-unavailable", "The admitted resource target", "Refresh tabs.get.");
				this.recordOpenRequest({
					requestId,
					result: { preview: {
						target: preview.target,
						asset,
						assetBinding: preview.assetBinding
					} },
					guid: asset.guid
				});
				this.changed();
				trace("target-admitted", { targetId: preview.target.targetId });
				return this.snapshot();
			} catch (error) {
				if (current()) {
					const failure = resolveWorkspaceFailure(error);
					publish("failed", {
						code: failure.code ?? "view-resource-open-failed",
						expected: failure.expected ?? "The asset preview to open",
						hint: failure.hint ?? (error instanceof Error ? error.message : String(error))
					});
					trace("failed");
				} else if (this.engine?.project === project) {
					if (this.openRequest?.requestId === requestId) this.openRequest = null;
					const entry = this.resourceOpens.get(asset.kind);
					if (entry?.pending?.requestId === requestId) {
						if (entry.preview) {
							const { pending: _pending, ...accepted } = entry;
							this.resourceOpens.set(asset.kind, accepted);
						} else this.resourceOpens.delete(asset.kind);
					}
					this.changed();
				}
				throw error;
			} finally {
				if (this.resourceRequests.get(asset.kind) === request) this.resourceRequests.delete(asset.kind);
			}
		}, context.signal);
	}
	async invokeDomain(operation, args = {}, { signal, caller, clientId = "view-owner", token, requestId } = {}, publishOpen = true) {
		const requestedAsset = operation === "asset.open" ? this.assets?.find((asset) => asset.guid === args.guid) : void 0;
		if (operation === "asset.open" && (args.detailsOnly === true || requestedAsset?.previewable === false || requestedAsset && ![
			"scene",
			"mesh",
			"material",
			"texture",
			"equirect"
		].includes(requestedAsset.kind))) {
			const result2 = await this.invoke("asset.inspect", args, {
				signal,
				caller,
				clientId,
				token,
				requestId
			});
			this.recordOpenRequest({
				requestId,
				result: result2,
				guid: args.guid,
				detailsOnly: true
			});
			this.changed();
			return this.snapshot();
		}
		caller ??= this.caller;
		const { tabId, ...input } = args;
		if (tabId !== void 0) this.assertWorkspaceTab(tabId);
		const inspector = operation.startsWith("plugins.");
		const presentation = operation.startsWith("display.");
		const history = operation.startsWith("history.");
		if (history) {
			if (!this.project) throw workspaceError("view-history-project-required", "an open project", "Open the project whose Engine operation history you want to read.");
			input.root = this.project.root;
			delete input.targetId;
			delete input.targetGeneration;
		}
		const id = inspector ? operation : `${presentation ? "view" : "engine"}.${operation}`;
		const sourceId = inspector || presentation ? "view-backend" : ENGINE_SOURCE;
		if (this.caller && !inspector && !presentation && !history && !operation.startsWith("run.") && input.targetId === void 0 && this.projectTarget) input.targetId = this.projectTarget.targetId;
		const owner = this.toolApi?.describe(id, sourceId).find((record) => record.callable)?.owner;
		if (!owner) throw workspaceError("view-workspace-operation-unavailable", `Engine operation ${operation} to be installed`, "Enable the Engine capability; UI plugins do not provide domain APIs.", { operation });
		const draftRequest = operation === "asset.source.draft" ? input.request : void 0;
		if (operation !== "asset.source.draft") this.syncBindings();
		if (operation === "asset.source.draft" && draftRequest?.action === "generate" && this.sceneSelection?.targetId === input.previewTargetId) {
			this.selectionAbort?.abort();
			this.sceneSelection = null;
			this.changed();
		}
		const play = this.engine?.play;
		if (operation === "play.stop" && this.targetBinding === "play" && play && input.targetId === play.target.targetId && input.targetGeneration === play.target.generation) {
			this.targetBinding = "scene";
			this.previewTargetId = this.scenePreview()?.target.targetId;
			this.changed();
		}
		const requestedPreview = [...this.previews(), this.engine?.play].find((preview) => preview?.target.targetId === input.targetId);
		const terminal = await this.toolApi.run(id, inspector ? {
			apiVersion: "forgeax.view.inspector/1",
			operation,
			args: input,
			...input,
			clientId,
			token,
			requestId
		} : presentation || history ? input : {
			...input,
			clientId
		}, {
			sourceId,
			providerId: owner.providerId,
			generation: owner.generation,
			caller,
			signal
		}).terminal;
		if (terminal.outcome === "failed") {
			const resolved = resolveWorkspaceFailure(terminal.failure);
			const addressesWorkspace = input.targetId === void 0 || [this.projectTarget, this.scenePreview()?.target].some((target) => target && target.targetId === input.targetId && (input.targetGeneration === void 0 || target.generation === input.targetGeneration));
			if (isWorkspaceTargetRecoveryCode(resolved.code) && addressesWorkspace) this.workspaceTargetLost = true;
			this.changed();
			throw workspaceError(resolved.code, resolved.expected, resolved.hint, resolved.detail);
		}
		signal?.throwIfAborted();
		const result = terminal.result;
		if (operation === "asset.source.draft") {
			const reply = result;
			if (draftRequest?.action === "generate" && "preview" in reply && reply.preview === "ready" && !reply.error) this.changed();
			return cloneWorkspaceValue(result);
		}
		if (Array.isArray(result?.assets)) this.assets = result.assets.map((asset) => serializeWorkspaceAsset({
			...asset,
			...asset.ddc || !asset.cookReceiptUrl ? {} : { ddc: { receiptUrl: asset.cookReceiptUrl } }
		}));
		if (result?.inspection) this.inspection = serializeWorkspaceInspection(result.inspection);
		if (operation === "preview.close") {
			for (const [kind, entry] of this.resourceOpens) if (entry.preview?.target.targetId === input.targetId) this.resourceOpens.delete(kind);
			if (this.openRequest?.preview?.target.targetId === input.targetId) this.openRequest = null;
		}
		if (operation === "asset.open") this.bindOpenedAsset(result, input.guid);
		if (operation === "preview.close" && input.targetId != null && String(input.targetId) === this.sceneTargetId) this.sceneTargetId = void 0;
		this.syncBindings();
		if (operation === "asset.open" && publishOpen) this.recordOpenRequest({
			requestId,
			result,
			guid: input.guid
		});
		if ((operation.startsWith("camera.") || operation === "target.control") && this.previewProjection && this.boundTarget() === requestedPreview) {
			this.previewProjection.camera = result?.camera;
			this.previewProjection.cameraVersion = result?.version;
			this.previewProjection.interaction = result?.interaction ?? null;
		}
		if (!history && ![
			"scene.tree.get",
			"entity.inspect",
			"workspace.get",
			"preview.capture",
			"preview.texture.get",
			"preview.material.get",
			"preview.display.get",
			"assets.thumbnails"
		].includes(operation)) this.changed();
		if (operation === "asset.open" && !publishOpen) return cloneWorkspaceValue(result);
		if ([
			"project.open",
			"project.close",
			"project.reopen",
			"asset.open",
			"preview.close",
			"camera.abort",
			"play.start",
			"play.ready",
			"play.stop"
		].includes(operation)) {
			if (operation === "project.open" || operation === "project.reopen") this.workspaceTargetLost = false;
			return this.snapshot();
		}
		if (operation.startsWith("camera.")) return {
			...cloneWorkspaceValue(result),
			apiVersion: VIEW_WORKSPACE_API_VERSION,
			target: requestedPreview?.target
		};
		if (operation === "assets.list") return {
			...cloneWorkspaceValue(result),
			assets: this.assets
		};
		return cloneWorkspaceValue(result);
	}
	assertWorkspaceTab(tabId) {
		requireWorkspaceString(tabId, "tabId");
		if (tabId !== "forgeax-user-workspace") throw workspaceError("view-workspace-tab-read-only", "the Scene binding", "Address AI execution through the Engine run API.", { tabId });
	}
	selectTab({ tabId } = {}) {
		if (!["forgeax-cli-display", "forgeax-user-workspace"].includes(tabId)) throw workspaceError("view-workspace-tab-not-found", "an existing tab", "Refresh tabs.get.", { tabId });
		this.selectedTabId = tabId;
		this.changed();
		return this.snapshot();
	}
	async selectSceneEntity(args = {}, context) {
		const entityId = requireWorkspaceString(args.entityId, "entityId");
		if (args.entityIds !== void 0 && !Array.isArray(args.entityIds)) throw workspaceError("view-workspace-selection-invalid", "An entity ID array", "Pass scene entity references.");
		const entityIds = args.entityIds === void 0 ? void 0 : [...new Set(args.entityIds.map((id) => requireWorkspaceString(id, "entityIds")))];
		if (entityIds && !entityIds.includes(entityId)) throw workspaceError("view-workspace-selection-invalid", "A primary entity in the selection", "Include the primary entity ID.");
		return this.changeSceneSelection(args, context, () => ({
			entityId,
			label: args.label,
			...entityIds && entityIds.length > 1 ? { entityIds } : {}
		}));
	}
	pickSceneEntity(args = {}, context) {
		return this.changeSceneSelection(args, context, async (requestContext) => {
			const result = await this.invoke("target.pick", {
				...args,
				granularity: "triangle"
			}, requestContext);
			if (result?.granularity !== "triangle") throw workspaceError("view-workspace-operation-unavailable", "the Engine triangle-picking capability", "Pair this View build with an Engine target that supports triangle granularity.", {
				operation: "target.pick",
				granularity: result?.granularity
			});
			if (result?.entityId === null) return null;
			return { entityId: requireWorkspaceString(result?.entityId, "pick.entityId") };
		});
	}
	clearSceneSelection(args = {}, context) {
		return this.changeSceneSelection(args, context, () => null);
	}
	async changeSceneSelection({ tabId, targetId, targetGeneration } = {}, context, resolveSelection) {
		if (tabId !== void 0) this.assertWorkspaceTab(tabId);
		this.syncBindings();
		const requested = this.boundTarget();
		if (!requested || requested.target.targetId !== targetId || requested.target.generation !== targetGeneration) throw workspaceError("view-workspace-selection-stale", "The bound target and generation", "Select the target before changing its selection.");
		this.selectionAbort?.abort();
		const controller = new AbortController();
		this.selectionAbort = controller;
		const signal = context?.signal ? AbortSignal.any([context.signal, controller.signal]) : controller.signal;
		const requestContext = {
			...context,
			signal
		};
		const assertCurrent = () => {
			signal.throwIfAborted();
			if (this.boundTarget() !== requested) throw workspaceError("view-workspace-selection-stale", "The same selected target", "Refresh the hierarchy.");
		};
		try {
			const selection = await resolveSelection(requestContext);
			assertCurrent();
			const { entityId, label } = selection ?? {};
			if (selection) {
				const result = await this.invoke("entity.inspect", {
					entityId,
					targetId,
					targetGeneration
				}, requestContext);
				assertCurrent();
				if (result?.entityId !== entityId) throw workspaceError("view-workspace-selection-stale", "The inspected entity on the same target", "Refresh the hierarchy before selecting.");
			}
			await this.invoke("entity.highlight", {
				...selection ? { entityId } : {},
				targetId,
				targetGeneration
			}, requestContext);
			assertCurrent();
			this.sceneSelection = selection ? {
				primary: {
					entityId,
					...label === void 0 ? {} : { label: String(label) }
				},
				...selection.entityIds ? { entityIds: selection.entityIds } : {},
				targetId: requested.target.targetId,
				targetGeneration: requested.target.generation
			} : null;
			this.changed();
			return this.snapshot();
		} catch (error) {
			if (controller.signal.aborted && this.selectionAbort !== controller && this.boundTarget() === requested) throw workspaceError("view-workspace-selection-superseded", "the latest selection request", "A newer selection replaced this request.");
			throw error;
		}
	}
	async openProject(args, context) {
		await this.invoke("project.open", args, context);
		return this.snapshot();
	}
	async reopenProject(args = {}, context) {
		const root = resolveWorkspaceReopenRoot(this.snapshot(), args.root);
		const { tabId, ...rest } = args;
		return this.openProject({
			...rest,
			root,
			...tabId === void 0 ? {} : { tabId }
		}, context);
	}
	closeProject(args, context) {
		return this.invoke("project.close", args, context);
	}
	listAssets(args, context) {
		return this.invoke("assets.list", args, context);
	}
	inspectAsset(args, context) {
		return this.invoke("asset.inspect", args, context);
	}
	rebuildAssetSource(args, { mode = "rebuild", ...context } = {}) {
		return this.invoke(`asset.source.${mode}`, args, context);
	}
	bindOpenedAsset(result, guid) {
		this.targetBinding = "scene";
		if ((this.hydrateAsset(result?.preview?.asset)?.kind ?? this.hydrateAsset(result?.asset)?.kind ?? this.assets?.find((entry) => entry?.guid === guid)?.kind) === "scene") {
			const targetId = result?.preview?.target?.targetId ?? result?.target?.targetId;
			if (targetId != null) {
				this.sceneTargetId = String(targetId);
				this.previewTargetId = this.sceneTargetId;
			}
			return;
		}
		const sceneId = this.scenePreview()?.target?.targetId;
		if (sceneId !== void 0) this.previewTargetId = sceneId;
	}
	recordOpenRequest({ requestId, result, guid, detailsOnly = false }) {
		const requested = typeof guid === "string" && guid.trim() !== "" ? guid : void 0;
		const scene = this.scenePreview();
		const sceneIds = sceneTargetIds(this.classifiedPreviews(), scene ? {
			target: scene.target,
			asset: this.hydrateAsset(scene.asset)
		} : void 0);
		const preview = [result?.preview].find((entry) => entry?.target && !sceneIds.has(String(entry.target.targetId)) && (!entry.asset || requested === void 0 || entry.asset.guid === requested));
		const catalogAsset = requested && Array.isArray(this.assets) ? this.assets.find((entry) => entry?.guid === requested && entry?.kind) : void 0;
		const asset = [
			this.hydrateAsset(result?.preview?.asset),
			this.hydrateAsset(result?.asset),
			this.hydrateAsset(result?.inspection?.asset),
			this.hydrateAsset(preview?.asset),
			catalogAsset
		].find((candidate) => candidate?.guid && candidate?.kind && (requested === void 0 || candidate.guid === requested));
		if (!asset?.guid || !asset?.kind) {
			logResourceOpen("open-request-skipped", {
				reason: "asset-kind-unavailable",
				requested: requested ?? null,
				resultPreview: summarizeResourceAsset(result?.preview?.asset),
				resultAsset: summarizeResourceAsset(result?.asset),
				extraPreview: summarizeResourceAsset(preview?.asset),
				catalog: summarizeResourceAsset(catalogAsset),
				sceneTargetId: this.sceneTargetId ?? null
			}, { level: "warn" });
			return;
		}
		this.openRequestSequence += 1;
		const inspection = result?.inspection?.guid === asset.guid ? result.inspection : this.inspection?.guid === asset.guid ? this.inspection : void 0;
		const recordedPreview = preview?.target && (!preview.asset || preview.asset.guid === asset.guid) ? {
			asset,
			target: preview.target,
			assetBinding: preview.assetBinding
		} : void 0;
		this.openRequest = serializeWorkspaceOpenRequest({
			requestId: typeof requestId === "string" && requestId.trim() !== "" ? requestId : createWorkspaceId("open"),
			sequence: this.openRequestSequence,
			asset,
			phase: "ready",
			preview: detailsOnly ? void 0 : recordedPreview,
			...detailsOnly ? { detailsOnly: true } : {},
			...inspection === void 0 ? {} : { inspection }
		});
		this.resourceOpens.set(asset.kind, {
			requestId: this.openRequest.requestId,
			catalogEpoch: this.catalogEpoch,
			asset,
			preview: detailsOnly ? void 0 : recordedPreview,
			sequence: this.openRequestSequence,
			...detailsOnly ? { detailsOnly: true } : {}
		});
		logResourceOpen("open-request-recorded", {
			requestId: this.openRequest.requestId,
			sequence: this.openRequest.sequence,
			asset: summarizeResourceAsset(this.openRequest.asset),
			hasPreview: Boolean(this.openRequest.preview?.target),
			previewTargetId: this.openRequest.preview?.target?.targetId ?? null
		});
	}
	openAsset(args, context) {
		return this.invoke("asset.open", args, context);
	}
	closePreview(args, context) {
		return this.invoke("preview.close", args, context);
	}
	capture(args, context) {
		return this.invoke("preview.capture", args, context);
	}
	resizePreview(args, context) {
		return this.invoke("preview.resize", args, context);
	}
	getCamera(args, context) {
		return this.invoke("camera.get", args, context);
	}
	beginCamera(args, context) {
		return this.invoke("camera.begin", {
			...args,
			interactionId: args.interactionId ?? randomUUID()
		}, context);
	}
	updateCamera(args, context) {
		return this.invoke("camera.update", args, context);
	}
	commitCamera(args, context) {
		return this.invoke("camera.commit", args, context);
	}
	abortCamera(args, context) {
		return this.invoke("camera.abort", args, context);
	}
	getSceneTree(args, context) {
		return this.invoke("scene.tree.get", args, context);
	}
	async revokeConnection(connectionId) {
		if (typeof connectionId !== "string") return;
		if (!this.pageSessions.has(connectionId) && ![...this.pendingReveals.values()].some((pending) => pending.connectionId === connectionId)) return;
		for (const [requestId, pending] of this.pendingReveals) {
			if (pending.connectionId !== connectionId) continue;
			this.pendingReveals.delete(requestId);
			pending.settle({
				ok: false,
				code: "view-page-gone",
				requestId
			});
		}
		const page = this.pageSessions.get(connectionId);
		if (page) {
			this.pageSessions.delete(connectionId);
			page.unsubscribe();
			if (![...this.pageSessions.values()].some((other) => other.broker === page.broker)) await page.broker.dispose();
		}
		for (const preview of [this.engine?.preview, this.engine?.play]) {
			if (!preview) continue;
			try {
				const result = await preview.revokeConnection?.({
					targetId: preview.target.targetId,
					connectionId
				});
				this.syncBindings();
				if (this.previewOwner === preview && this.previewProjection && result) {
					this.previewProjection.interaction = result.interaction ?? null;
					this.previewProjection.cameraVersion = result.version;
				}
			} catch {}
		}
		this.changed();
	}
	/** One accepted View frontend owns one presentation projection and event stream. */
	attachPageSession(caller, transport) {
		const engine = this.engineForCaller ? this.engineForCaller(caller) : this.engine;
		const projectTarget = engine?.project?.target;
		const projectCaller = projectTarget && caller.sourceId === `forgeax-workspace:${projectTarget.sessionId}:${projectTarget.targetId}`;
		if (caller.kind !== "frontend" || caller.sourceId !== "view-frontend" && !projectCaller || this.pageSessions.has(caller.connectionId)) return;
		const broker = (this.engineForCaller && projectCaller ? this.pageConnections().find(([, page]) => page.broker.caller?.sourceId === "view-frontend" && page.broker.engine === engine)?.[1] : void 0)?.broker ?? new _ViewWorkspaceBroker({
			engine,
			toolApi: this.toolApi,
			display: () => this.display(caller),
			...this.engineForCaller && caller.sourceId === "view-frontend" ? { projectIntent: () => this.project?.root } : {},
			accessToken: this.accessToken,
			authorize: this.authorize,
			packSources: this.packSources
		}, caller);
		broker.snapshot();
		if (engine === this.engine) broker.assets = this.assets;
		broker.catalogEpoch = this.catalogEpoch;
		broker.thumbnailEpoch = this.thumbnailEpoch;
		const unsubscribe = broker.subscribe((state) => transport.publish(VIEW_WORKSPACE_STATE_TOPIC, state, { connectionId: caller.connectionId }));
		this.pageSessions.set(caller.connectionId, {
			broker,
			unsubscribe
		});
	}
	publishPageSessions() {
		for (const { broker } of this.pageSessions.values()) {
			broker.snapshot();
			if (broker.engine === this.engine && this.assets !== null) broker.assets = this.assets;
			broker.changed();
		}
	}
	async revealPack(input, signal) {
		const transport = this.transport;
		if (!transport) return {
			ok: false,
			code: "view-page-unavailable"
		};
		if (signal?.aborted) return {
			ok: false,
			code: "view-reveal-cancelled"
		};
		const candidates = [...this.pageSessions.keys()];
		if (!input.connectionId && candidates.length !== 1) return {
			ok: false,
			code: candidates.length ? "view-page-ambiguous" : "view-page-unavailable",
			candidates
		};
		const connectionId = input.connectionId ?? candidates[0];
		const page = this.pageSessions.get(connectionId);
		if (!page) return {
			ok: false,
			code: "view-page-gone"
		};
		const project = page.broker.project;
		if (!project || project.id !== input.projectId) return {
			ok: false,
			code: "view-project-stale"
		};
		if (!this.packSources) return {
			ok: false,
			code: "view-pack-sources-unavailable"
		};
		const source = (await this.packSources(project.root, project.assetRoots ?? [])).sources.find((row) => row.sourcePath === input.sourcePath);
		if (signal?.aborted) return {
			ok: false,
			code: "view-reveal-cancelled"
		};
		if (!source || source.revision !== input.revision || input.packageId && source.packageId !== input.packageId) return {
			ok: false,
			code: "view-pack-stale"
		};
		const requestId = randomUUID();
		const intent = {
			requestId,
			connectionId,
			projectId: input.projectId,
			sourcePath: input.sourcePath,
			revision: input.revision,
			...source.packageId ? { packageId: source.packageId } : {}
		};
		return new Promise((resolve2) => {
			const retire = (code) => {
				this.pendingReveals.delete(requestId);
				transport.publish(VIEW_PACK_REVEAL_TOPIC, {
					...intent,
					cancelled: true
				}, { connectionId });
				settle({
					ok: false,
					code,
					requestId
				});
			};
			const cancel = () => {
				retire("view-reveal-cancelled");
			};
			const settle = (value) => {
				clearTimeout(timeout);
				signal?.removeEventListener("abort", cancel);
				resolve2(value);
			};
			const timeout = setTimeout(() => {
				retire("view-reveal-timeout");
			}, 12e3);
			timeout.unref?.();
			this.pendingReveals.set(requestId, {
				connectionId,
				projectId: input.projectId,
				sourcePath: input.sourcePath,
				revision: input.revision,
				settle
			});
			signal?.addEventListener("abort", cancel, { once: true });
			transport.publish(VIEW_PACK_REVEAL_TOPIC, intent, { connectionId });
		});
	}
	resolvePageConnection(caller, requested) {
		const own = caller && this.pageSessions.get(caller.connectionId)?.broker.caller?.connectionId;
		if (caller?.kind === "frontend") {
			if (!own || !this.pageSessions.has(own) || requested !== void 0 && requested !== own) throw workspaceError("view-presentation-page-denied", "the frontend's own accepted View document", "Use this document's connection identity.");
			return own;
		}
		if (requested !== void 0) {
			const id = requireWorkspaceString(requested, "connectionId");
			if (!this.pageSessions.has(id)) throw workspaceError("view-page-gone", "a connected View document", "Read pages.list.");
			return id;
		}
		const pages = this.pageConnections();
		if (pages.length !== 1) throw workspaceError(pages.length ? "view-page-ambiguous" : "view-page-unavailable", "one connected View document", "Read pages.list and pass its connectionId.");
		return pages[0][0];
	}
	registerTransport(transport, { routeThroughTools = false } = {}) {
		this.transport = transport;
		const presentation = createPresentationRelay(transport, (caller, requested) => this.resolvePageConnection(caller, requested));
		this.presentation = presentation;
		const capabilities = transport.register(VIEW_WORKSPACE_SERVICES.capabilities, () => this.capabilities());
		const call = transport.register(VIEW_WORKSPACE_SERVICES.call, async ({ payload, signal, caller }) => {
			try {
				this.attachPageSession(caller, transport);
				return routeThroughTools ? await runWorkspaceToolApi(this.toolApi, {
					operation: `view.workspace.${payload.operation}`,
					args: payload.args,
					clientId: payload.clientId,
					token: payload.token,
					requestId: payload.requestId,
					caller,
					signal,
					sourceId: "view-workspace"
				}) : await this.call(payload, {
					signal,
					caller
				});
			} catch (error) {
				const failure = workspaceDiagnosticRecord(error);
				if (typeof failure.code !== "string" || !failure.code.startsWith("view-")) throw error;
				throw Object.assign(new Error(String(failure.message)), {
					name: "HostAssemblyError",
					code: "host-transport-failure",
					expected: failure.expected,
					hint: failure.hint,
					detail: {
						...workspaceDiagnosticRecord(failure.detail),
						remoteCode: failure.code
					}
				});
			}
		});
		const fileGet = transport.register(VIEW_FILE_GET_SERVICE, async ({ payload, caller }) => {
			try {
				return await readWorkspaceFilePreview(this.pageSessions.get(caller.connectionId)?.broker ?? this, payload);
			} catch (error) {
				const failure = workspaceDiagnosticRecord(error);
				if (typeof failure.code !== "string" || !failure.code.startsWith("view-")) throw error;
				throw Object.assign(new Error(String(failure.message)), {
					name: "HostAssemblyError",
					code: "host-transport-failure",
					expected: failure.expected,
					hint: failure.hint,
					detail: {
						...workspaceDiagnosticRecord(failure.detail),
						remoteCode: failure.code
					}
				});
			}
		});
		const htmlFiles = transport.register(VIEW_HTML_FILES_SERVICE, async ({ caller }) => listWorkspaceHtmlFiles(this.pageSessions.get(caller.connectionId)?.broker ?? this));
		const packSources = transport.register(VIEW_PACK_SOURCES_SERVICE, async ({ payload, caller }) => {
			const project = (this.pageSessions.get(caller.connectionId)?.broker ?? this).project;
			if (!project || payload?.projectId !== project.id) throw workspaceError("view-project-stale", "the currently open project", "Refresh the workspace before listing Pack sources.");
			if (!this.packSources) throw workspaceError("view-pack-sources-unavailable", "an installed Pack source provider", "Update the View Host Pack.");
			return this.packSources(project.root, project.assetRoots ?? []);
		});
		const revealAck = transport.register(VIEW_PACK_REVEAL_ACK_SERVICE, async ({ payload, caller }) => {
			const requestId = typeof payload?.requestId === "string" ? payload.requestId : "";
			const pending = this.pendingReveals.get(requestId);
			if (!pending || pending.connectionId !== caller.connectionId) return {
				ok: false,
				code: "view-reveal-stale"
			};
			if (pending.projectId !== payload.projectId || pending.sourcePath !== payload.sourcePath || pending.revision !== payload.revision) return {
				ok: false,
				code: "view-reveal-identity-mismatch"
			};
			const project = this.pageSessions.get(caller.connectionId)?.broker.project;
			const source = project && this.packSources ? (await this.packSources(project.root, project.assetRoots ?? [])).sources.find((row) => row.sourcePath === pending.sourcePath) : void 0;
			if (this.pendingReveals.get(requestId) !== pending) return {
				ok: false,
				code: "view-reveal-stale"
			};
			if (!project || project.id !== pending.projectId || source?.revision !== pending.revision) {
				this.pendingReveals.delete(requestId);
				pending.settle({
					ok: false,
					code: "view-reveal-stale",
					requestId
				});
				return {
					ok: false,
					code: "view-reveal-stale"
				};
			}
			this.pendingReveals.delete(requestId);
			pending.settle({
				ok: payload.shown === true,
				code: payload.shown === true ? "shown" : "view-reveal-not-shown",
				requestId,
				connectionId: caller.connectionId,
				projectId: payload.projectId,
				sourcePath: payload.sourcePath,
				revision: payload.revision,
				...typeof payload.reason === "string" ? { reason: payload.reason.slice(0, 160) } : {}
			});
			return { ok: true };
		});
		const subscription = this.subscribe((state) => transport.publish(VIEW_WORKSPACE_STATE_TOPIC, state, { excludeConnectionIds: [...this.pageSessions.keys()] }));
		const removeConnect = transport.onClientConnect((caller) => this.attachPageSession(caller, transport));
		const removeDisconnect = transport.onClientDisconnect((caller) => {
			this.revokeConnection(caller.connectionId);
		});
		const observer = transport.connect();
		const engineSubscription = observer.subscribe("engine.workspace.state", (snapshot) => {
			const epoch = snapshot && typeof snapshot.catalogEpoch === "number" ? snapshot.catalogEpoch : void 0;
			const thumbnailEpoch = snapshot && typeof snapshot.thumbnailEpoch === "number" ? snapshot.thumbnailEpoch : void 0;
			const brokers = [this, ...[...this.pageSessions.values()].map((page) => page.broker)];
			if (thumbnailEpoch !== void 0 && thumbnailEpoch > this.thumbnailEpoch) {
				this.thumbnailEpoch = thumbnailEpoch;
				for (const broker of brokers) broker.thumbnailEpoch = thumbnailEpoch;
			}
			if (epoch === void 0 || epoch <= this.catalogEpoch) {
				this.changed();
				this.publishPageSessions();
				return;
			}
			this.catalogEpoch = epoch;
			for (const broker of brokers) {
				broker.catalogEpoch = epoch;
				const project = broker.project;
				if (!project || broker.engine?.project?.phase !== void 0 && broker.engine.project.phase !== "running") continue;
				const lost = broker.workspaceTargetLost;
				broker.invoke("assets.list", { projectId: project.id }).catch(() => {
					broker.workspaceTargetLost = lost;
				}).finally(() => broker.changed());
			}
			this.publishPageSessions();
		});
		return () => {
			presentation.dispose();
			if (this.presentation === presentation) this.presentation = void 0;
			if (this.transport === transport) this.transport = void 0;
			capabilities();
			call();
			fileGet();
			htmlFiles();
			packSources();
			revealAck();
			subscription();
			removeConnect();
			removeDisconnect();
			engineSubscription();
			observer.close();
		};
	}
	async dispose() {
		this.resourceLifetime.abort();
		this.selectionAbort?.abort();
		this.disposing = true;
		this.listeners.clear();
		this.presentation?.dispose();
		this.presentation = void 0;
		for (const [requestId, pending] of this.pendingReveals) {
			this.pendingReveals.delete(requestId);
			pending.settle({
				ok: false,
				code: "view-page-gone",
				requestId
			});
		}
		for (const [connectionId, page] of this.pageSessions) {
			this.pageSessions.delete(connectionId);
			page.unsubscribe();
			await page.broker.dispose();
		}
	}
};
var backend_default$1 = {
	name: "forgeax.view.service.workspace.backend",
	inject: ["toolApi"],
	provide: ["viewWorkspaceCore", "viewWorkspaceAccessToken"],
	apply(ctx, config = {}) {
		const workspace = new ViewWorkspaceBroker({
			engine: ctx.get?.("engineWorkspace", false),
			engineForCaller: ctx.get?.("engineWorkspaceForCaller", false),
			toolApi: ctx.get?.("toolApi", false),
			display: (caller) => ctx.get?.("viewStatus", false)?.(caller),
			accessToken: config.workspaceAccessToken,
			authorize: config.workspaceAuthorize,
			packSources: config.packSources
		});
		const toolApi = ctx.get?.("toolApi", false);
		const tools = createWorkspaceToolContributions(workspace, defineWorkspaceOperations(VIEW_WORKSPACE_OPERATIONS.map((operation) => ({
			id: `view.workspace.${operation}`,
			operation
		}))));
		tools.push(defineTool({
			id: "view.workspace.call",
			path: [
				"view",
				"workspace",
				"call"
			],
			title: "Call View workspace API",
			summary: "Call an operation on the running View workspace.",
			realm: "host",
			argsSchema: toolJsonSchema({
				type: "object",
				properties: {
					operation: { type: "string" },
					args: { type: "object" },
					root: { type: "string" }
				},
				required: ["operation"],
				additionalProperties: false
			}),
			resultSchema: toolJsonSchema({}),
			inputSchema: { type: "object" },
			outputSchema: {},
			evidence: []
		}, async (input, context) => {
			return workspaceToolValue(await workspace.call(createWorkspaceRequest(input.operation, input.args ?? {}, {
				clientId: "view-cli",
				token: workspace.accessToken
			}), {
				signal: context.signal,
				caller: context.caller
			}));
		}));
		const revokeTools = toolApi ? registerTools(ctx, tools, {
			sourceId: "view-workspace",
			module: "@forgeax/view-workspace-core/backend",
			realm: "host"
		}) : void 0;
		const connection = ctx.get?.("hostTransport", false);
		const transport = connection && "register" in connection ? connection : void 0;
		const unregister = transport ? workspace.registerTransport(transport, { routeThroughTools: Boolean(revokeTools) }) : void 0;
		ctx.provide("viewWorkspaceCore", workspace);
		ctx.provide("viewWorkspaceAccessToken", workspace.accessToken);
		ctx.effect(() => async () => {
			unregister?.();
			await revokeTools?.();
			await workspace.dispose();
		});
	}
};
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-JCSEA2UC.mjs
var PLUGINS_OPERATION_DESCRIPTIONS = defineWorkspaceOperations([
	{
		id: "plugins.sources",
		summary: "List observable View plugin sources."
	},
	{
		id: "plugins.inspect",
		summary: "Inspect a View plugin source."
	},
	{
		id: "plugins.watch",
		summary: "Watch a View plugin source."
	}
]);
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-QB5O6EZW.mjs
var identity_exports$12 = {};
__export(identity_exports$12, {
	BACKEND_MODULE: () => BACKEND_MODULE,
	BACKEND_PLUGIN_ID: () => BACKEND_PLUGIN_ID,
	FRONTEND_MODULE: () => FRONTEND_MODULE$12,
	FRONTEND_PLUGIN_ID: () => FRONTEND_PLUGIN_ID$12,
	PAGE_TYPE: () => PAGE_TYPE$10,
	PANEL_LAYOUT: () => PANEL_LAYOUT$5,
	PLUGIN_ID: () => PLUGIN_ID$8,
	SLOT: () => SLOT$5,
	TITLE_I18N_KEY: () => TITLE_I18N_KEY$5
});
var PLUGIN_ID$8 = "forgeax.view.plugins";
var BACKEND_PLUGIN_ID = "forgeax.view.service.plugin-inspection.backend";
var FRONTEND_PLUGIN_ID$12 = "forgeax.view.page.plugin-browser.frontend";
var BACKEND_MODULE = "@forgeax/view/plugins/plugins/backend";
var FRONTEND_MODULE$12 = "@forgeax/view/plugins/plugins/frontend";
var SLOT$5 = "plugins";
var PAGE_TYPE$10 = VIEW_PAGE_TYPES.plugins;
var PANEL_LAYOUT$5 = Object.freeze({
	dock: "fill",
	stack: "tabs",
	order: 0
});
var TITLE_I18N_KEY$5 = "view.slots.plugins";
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-7AZKLQP7.mjs
var recordOf = workspaceDiagnosticRecord;
var recordList = (value) => Array.isArray(value) ? value.filter((item) => item !== null && typeof item === "object") : [];
var VIEW_INSPECTOR_API_VERSION = "forgeax.view.inspector/1";
var VIEW_INSPECTOR_SERVICES = Object.freeze({
	sources: "forgeax.view.inspector.sources",
	inspect: "forgeax.view.inspector.inspect",
	watch: "forgeax.view.inspector.watch",
	unwatch: "forgeax.view.inspector.unwatch",
	report: "forgeax.view.inspector.report"
});
var VIEW_INSPECTOR_TOPIC = "forgeax.view.inspector.changed";
var VIEW_INSPECTOR_OPERATIONS = Object.freeze(PLUGINS_OPERATION_DESCRIPTIONS.map((description) => description.id));
var VIEW_INSPECTOR_INTERNAL_OPERATIONS = Object.freeze(["plugins.report", "plugins.unwatch"]);
var INSPECTOR_OPERATION_SET = /* @__PURE__ */ new Set([...VIEW_INSPECTOR_OPERATIONS, ...VIEW_INSPECTOR_INTERNAL_OPERATIONS]);
new Set(VIEW_WORKSPACE_DOMAIN_OPERATIONS);
var MAX_TEXT = 512;
var SAFE_ERROR_FIELDS = /* @__PURE__ */ new Set([
	"actual",
	"actualGeneration",
	"expectedGeneration",
	"fiberState",
	"generation",
	"module",
	"operation",
	"phase",
	"providerId",
	"reason",
	"remoteCode",
	"runId",
	"service",
	"sourceId",
	"watchId"
]);
function redactCredentials(value) {
	return value.replace(/([a-z][a-z\d+.-]*:\/\/)([^\s/?#]+)@/gi, "$1[redacted]@").replace(/\b(authorization|proxy-authorization)\b\s*([:=])\s*(?:(?:bearer|basic)\s+)?[^\s,;)}\]]+/gi, (_match, key, separator) => `${key}${separator}[redacted]`).replace(/\b(bearer|basic)\s+[a-z\d._~+\/-]+=*/gi, "$1 [redacted]").replace(/([?&](?:token|password|passwd|secret|authorization|api[-_]?key|access[-_]?token)=)[^&#\s,;)}\]]+/gi, "$1[redacted]").replace(/\b(token|password|passwd|secret|authorization|api[-_]?key|access[-_]?token)\b\s*([:=])\s*("[^"]*"|'[^']*'|\[[^\]]*\]|[^\s,;)}\]]+)/gi, (_match, key, separator) => `${key}${separator}[redacted]`).replace(/\b(secret|password|passwd|token)(?:[-_][a-z\d][a-z\d_.-]*)?\b/gi, "[redacted]").replace(/\b(secret|password|passwd|token|api[-_]?key|access[-_]?token)[-_][a-z\d][a-z\d_.-]*\b/gi, "[redacted]");
}
function safeText(value, fallback = "unknown") {
	const redacted = redactCredentials(typeof value === "string" ? value : value === void 0 ? fallback : String(value));
	return redacted.length > MAX_TEXT ? `${redacted.slice(0, MAX_TEXT)}...` : redacted;
}
function safeStringArray(value) {
	if (!Array.isArray(value)) return void 0;
	return value.filter((entry) => typeof entry === "string").slice(0, 64).map((entry) => safeText(entry));
}
function safeDetail(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
	const result = {};
	for (const [key, entry] of Object.entries(value)) {
		if (!SAFE_ERROR_FIELDS.has(key)) continue;
		if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean" || entry === null) result[key] = typeof entry === "string" ? safeText(entry) : entry;
		else if (Array.isArray(entry) && entry.every((item) => typeof item === "string")) result[key] = entry.map((item) => safeText(item));
	}
	return Object.keys(result).length === 0 ? void 0 : result;
}
function safeError(value) {
	if (value === void 0 || value === null) return void 0;
	const error = recordOf(value), safe = safeDetail(error.detail);
	return {
		code: safeText(error.code, "unknown-error"),
		expected: safeText(error.expected),
		hint: safeText(error.hint),
		...safe === void 0 ? {} : { detail: safe }
	};
}
function safeSchema(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
	const allowed = /* @__PURE__ */ new Set([
		"additionalProperties",
		"const",
		"description",
		"enum",
		"items",
		"maximum",
		"minimum",
		"properties",
		"required",
		"type"
	]);
	const project = (schema) => {
		if (!schema || typeof schema !== "object" || Array.isArray(schema)) return void 0;
		const result = {};
		for (const [key, entry] of Object.entries(schema)) {
			if (!allowed.has(key)) continue;
			if (key === "properties" && entry && typeof entry === "object" && !Array.isArray(entry)) {
				result.properties = Object.fromEntries(Object.entries(entry).map(([name, child]) => [name, project(child)]).filter(([, child]) => child !== void 0));
				continue;
			}
			if (key === "items") {
				const child = project(entry);
				if (child !== void 0) result.items = child;
				continue;
			}
			if (key === "description") result.description = safeText(entry, "");
			else if (Array.isArray(entry)) result[key] = entry.filter((item) => typeof item === "string").map((item) => safeText(item));
			else if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") result[key] = entry;
		}
		return result;
	};
	return project(value);
}
function safeOwner(value) {
	if (!value || typeof value !== "object") return null;
	const owner = recordOf(value);
	return {
		providerId: safeText(owner.providerId),
		sourceId: safeText(owner.sourceId),
		generation: typeof owner.generation === "number" && Number.isSafeInteger(owner.generation) ? owner.generation : null,
		realm: safeText(owner.realm),
		...owner.fiberId === void 0 ? {} : { fiberId: safeText(owner.fiberId) },
		...owner.module === void 0 ? {} : { module: safeText(owner.module) }
	};
}
function safeToolDescriptor(value) {
	if (!value || typeof value !== "object") return null;
	const descriptor = recordOf(value);
	return {
		id: safeText(descriptor.id),
		path: Array.isArray(descriptor.path) ? descriptor.path.filter((value2) => typeof value2 === "string").map((value2) => safeText(value2)) : safeText(descriptor.id).split("."),
		title: safeText(descriptor.title),
		summary: safeText(descriptor.summary),
		realm: safeText(descriptor.realm),
		evidence: Array.isArray(descriptor.evidence) ? descriptor.evidence.filter((value2) => typeof value2 === "string").map((value2) => safeText(value2)) : [],
		...descriptor.inputSchema === void 0 ? {} : { inputSchema: safeSchema(descriptor.inputSchema) },
		...descriptor.outputSchema === void 0 ? {} : { outputSchema: safeSchema(descriptor.outputSchema) },
		...Array.isArray(descriptor.capabilities) ? { capabilities: descriptor.capabilities.map((value2) => safeText(value2)) } : {},
		...Array.isArray(descriptor.errors) ? { errors: descriptor.errors.map((value2) => safeText(value2)) } : {}
	};
}
function safePluginEntry(value) {
	if (!value || typeof value !== "object") return null;
	const entry = recordOf(value), origin = recordOf(entry.origin);
	const desiredState = entry.desiredState === "disabled" || entry.disabled === true ? "disabled" : "enabled";
	const candidate = entry.fiberState ?? entry.state;
	const state = typeof candidate === "string" && [
		"pending",
		"loading",
		"active",
		"failed",
		"disposed",
		"disabled",
		"unloading",
		"unknown"
	].includes(candidate) ? candidate : void 0;
	return {
		entryId: safeText(entry.entryId ?? entry.id ?? (entry.uid == null ? void 0 : `fiber:${entry.uid}`)),
		module: safeText(entry.module ?? entry.name),
		realm: safeText(entry.realm),
		desiredState,
		...(origin.guid ?? entry.assetGuid) === void 0 ? {} : { assetGuid: safeText(origin.guid ?? entry.assetGuid) },
		...(origin.program ?? entry.program) === void 0 ? {} : { program: safeText(origin.program ?? entry.program) },
		...(entry.fiberId ?? entry.uid) == null ? {} : { fiberId: safeText(String(entry.fiberId ?? entry.uid)) },
		...entry.parent === void 0 ? {} : { parent: safeText(entry.parent) },
		...safeStringArray(entry.requiredServices) === void 0 ? {} : { requiredServices: safeStringArray(entry.requiredServices) },
		...safeStringArray(entry.providedServices) === void 0 ? {} : { providedServices: safeStringArray(entry.providedServices) },
		...safeStringArray(entry.missingServices) === void 0 ? {} : { missingServices: safeStringArray(entry.missingServices) },
		...entry.configDigest === void 0 ? {} : { configDigest: safeText(entry.configDigest) },
		...state === void 0 ? {} : { fiberState: state },
		...entry.failure === void 0 ? {} : { failure: safeError(entry.failure) }
	};
}
function safeToolSnapshot(value) {
	const snapshot = recordOf(value);
	return {
		providers: recordList(snapshot.providers).map((provider) => ({
			owner: safeOwner(provider.owner),
			state: safeText(provider.state),
			callable: provider.callable === true,
			...provider.fiberState === void 0 ? {} : { fiberState: safeText(provider.fiberState) },
			operationIds: Array.isArray(provider.operationIds) ? provider.operationIds.map((value2) => safeText(value2)) : []
		})),
		operations: recordList(snapshot.operations).map((operation) => ({
			descriptor: safeToolDescriptor(operation.descriptor),
			owner: safeOwner(operation.owner),
			providerState: safeText(operation.providerState),
			declared: operation.declared === true,
			callable: operation.callable === true,
			...operation.fiberState === void 0 ? {} : { fiberState: safeText(operation.fiberState) }
		})),
		...!value || typeof value !== "object" ? { state: "unavailable" } : {}
	};
}
function actualPluginEntries(status, supplied = []) {
	const entries = recordList(recordOf(status).entries).map(safePluginEntry).filter((entry) => entry !== null);
	const byId = new Map(entries.map((entry) => [entry.entryId, entry]));
	for (const entry of supplied) {
		const safe = safePluginEntry(entry);
		if (safe !== null) byId.set(safe.entryId, safe);
	}
	return [...byId.values()];
}
function safeAssembly(value) {
	const candidate = recordOf(value).current ?? value;
	if (!candidate || typeof candidate !== "object") return null;
	const assembly = recordOf(candidate), root = recordOf(assembly.root);
	return {
		revision: safeText(assembly.revision),
		schemaVersion: safeText(assembly.schemaVersion),
		sessionGeneration: typeof assembly.sessionGeneration === "number" ? assembly.sessionGeneration : void 0,
		root: assembly.root ? {
			program: safeText(root.program),
			codeRevision: safeText(root.codeRevision),
			...root.source === void 0 ? {} : { assetGuid: safeText(root.source) }
		} : null
	};
}
function safeActivationStatus(value) {
	if (!value || typeof value !== "object") return { state: "unknown" };
	const status = recordOf(value);
	const entries = Array.isArray(status.entries) ? recordList(status.entries).map((entry) => {
		const safe = safePluginEntry(entry);
		return {
			entryId: safe?.entryId ?? safeText(entry.entryId ?? entry.id),
			fiberState: safe?.fiberState ?? safeText(entry.fiberState),
			...safe?.parent === void 0 ? {} : { parent: safe.parent },
			...safe?.requiredServices === void 0 ? {} : { requiredServices: safe.requiredServices },
			...safe?.providedServices === void 0 ? {} : { providedServices: safe.providedServices },
			...safe?.configDigest === void 0 ? {} : { configDigest: safe.configDigest },
			...entry.failure === void 0 ? {} : { failure: safeError(entry.failure) }
		};
	}) : void 0;
	return {
		state: safeText(status.state),
		revision: safeText(status.revision),
		...entries === void 0 ? {} : { entries: [...new Map(entries.map((entry) => [entry.entryId, entry])).values()] },
		...status.error === void 0 ? {} : { error: safeError(status.error) }
	};
}
function sourceIdFor(caller) {
	return `view-frontend:${safeText(caller?.connectionId, "unknown-connection")}`;
}
function isAdmittedFrontend(value) {
	const caller = recordOf(value);
	return caller.kind === "frontend" && (caller.sourceId === "view-frontend" || /^forgeax-workspace:[^:\s]+:[^:\s]+$/.test(typeof caller.sourceId === "string" ? caller.sourceId : "")) && typeof caller.connectionId === "string" && caller.connectionId.length > 0 && typeof caller.capability === "string" && caller.capability.length > 0;
}
function assertInspectorRequest(value, expectedOperation) {
	const request = requireWorkspaceObject(value, "request");
	if (request.apiVersion !== "forgeax.view.inspector/1") throw workspaceError("view-inspector-version-mismatch", `API version ${VIEW_INSPECTOR_API_VERSION}`, "Install a matching View inspector client.", {
		actual: request.apiVersion,
		expected: VIEW_INSPECTOR_API_VERSION
	});
	if (!INSPECTOR_OPERATION_SET.has(String(request.operation)) || request.operation !== expectedOperation) throw workspaceError("view-inspector-operation-unknown", "operation to be present in the View inspector API", "Refresh inspector capabilities and use a supported operation.", { operation: request.operation });
	requireWorkspaceString(request.clientId, "clientId");
	requireWorkspaceString(request.requestId, "requestId");
	requireWorkspaceObject(request.args, "args");
	return {
		...request,
		apiVersion: String(request.apiVersion),
		operation: String(request.operation),
		clientId: requireWorkspaceString(request.clientId, "clientId"),
		requestId: requireWorkspaceString(request.requestId, "requestId"),
		args: requireWorkspaceObject(request.args, "args")
	};
}
function toolFailureError(failure) {
	const detail = recordOf(failure.detail);
	const operationCode = [detail?.code, detail?.remoteCode].find((candidate) => typeof candidate === "string" && candidate.startsWith("view-"));
	const payload = detail?.payload ?? detail?.detail;
	const diagnostic = [
		failure?.code,
		detail?.code,
		detail?.remoteCode
	].filter((value, index, values) => typeof value === "string" && values.indexOf(value) === index).join(" -> ");
	const preservedHint = (typeof failure?.hint === "string" && failure.hint.trim() !== "" ? failure.hint : void 0) ?? (typeof failure?.expected === "string" && failure.expected.trim() !== "" ? failure.expected : void 0);
	const hint = `${preservedHint ?? ""}${diagnostic ? `${preservedHint ? " " : ""}(provider: ${diagnostic})` : ""}`.trim();
	if (operationCode !== void 0) return workspaceError(operationCode, typeof detail.expected === "string" ? detail.expected : failure.expected, typeof detail.hint === "string" ? detail.hint : hint || preservedHint, {
		failure: safeError(failure) ?? { failure },
		...payload && typeof payload === "object" ? { cause: payload } : {}
	});
	return workspaceError("view-tool-provider-failed", typeof failure?.expected === "string" ? safeText(failure.expected) : preservedHint, hint || preservedHint, { failure: safeError(failure) });
}
async function runInspectorToolApi(api, { operation, payload, caller, signal, providerId, generation }) {
	const terminal = await api.run(operation, payload, {
		sourceId: "view-backend",
		providerId,
		generation,
		caller,
		signal
	}).terminal;
	if (terminal.outcome === "failed") throw toolFailureError(terminal.failure);
	return terminal.result;
}
function inspectorRequestSchema(operation) {
	return {
		parse(value) {
			try {
				return {
					ok: true,
					value: assertInspectorRequest(value, operation)
				};
			} catch (error) {
				return {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				};
			}
		},
		describe: "{\"type\":\"object\",\"required\":[\"apiVersion\",\"operation\",\"clientId\",\"requestId\",\"args\"]}"
	};
}
var inspectorResultSchema = {
	parse(value) {
		return value !== null && typeof value === "object" && !Array.isArray(value) ? {
			ok: true,
			value
		} : {
			ok: false,
			error: "inspector result must be an object"
		};
	},
	describe: "{\"type\":\"object\"}"
};
function inspectorFailure(error) {
	if (!(error instanceof ViewWorkspaceError)) throw error;
	return {
		ok: false,
		error: {
			code: error.code,
			expected: error.expected,
			hint: error.hint,
			detail: safeDetail(error.detail)
		}
	};
}
function createViewInspectorToolContributions(broker) {
	return [...VIEW_INSPECTOR_OPERATIONS, ...VIEW_INSPECTOR_INTERNAL_OPERATIONS].map((operation) => {
		const description = PLUGINS_OPERATION_DESCRIPTIONS.find((entry) => entry.id === operation);
		return defineTool({
			id: operation,
			path: description?.path ?? operation.split("."),
			title: description?.title ?? `Inspect ${operation}`,
			summary: description?.summary ?? `Internal View inspector operation ${operation}.`,
			realm: "host",
			argsSchema: inspectorRequestSchema(operation),
			resultSchema: inspectorResultSchema,
			inputSchema: { type: "object" },
			outputSchema: { type: "object" },
			evidence: []
		}, async (input, context) => {
			const request = input;
			try {
				const canonical = {
					...request,
					caller: context.caller
				};
				if (operation === "plugins.sources") return broker.sources(canonical);
				if (operation === "plugins.inspect") return broker.inspect(canonical);
				if (operation === "plugins.watch") return broker.watch(canonical);
				if (operation === "plugins.unwatch") return broker.unwatch(canonical);
				return await broker.report(canonical, context.caller);
			} catch (error) {
				return inspectorFailure(error);
			}
		});
	});
}
var ViewInspectorBroker = class {
	constructor({ transport, accessToken, hostAssembly, toolApi, context } = {}) {
		if (!transport || typeof transport.register !== "function") throw new TypeError("View inspector requires an Engine Host transport");
		this.transport = transport;
		this.accessToken = requireWorkspaceString(accessToken, "accessToken");
		this.hostAssembly = hostAssembly;
		this.toolApi = toolApi;
		this.context = context;
		this.reports = /* @__PURE__ */ new Map();
		this.watches = /* @__PURE__ */ new Map();
		this.frontendCapabilities = /* @__PURE__ */ new Map();
		this.disposers = [];
		this.backendSourceGeneration = 1;
	}
	grantFrontendConnection(caller) {
		if (!isAdmittedFrontend(caller)) throw workspaceError("view-inspector-unauthorized", "a real FrontendHost connection to receive the inspector capability", "Connect the frontend through the backend Host pairing before reporting activation.");
		this.frontendCapabilities.set(caller.connectionId, caller.capability);
		return caller.capability;
	}
	assertFrontendCaller(caller) {
		if (!isAdmittedFrontend(caller) || this.frontendCapabilities.get(caller.connectionId) !== caller.capability) throw workspaceError("view-inspector-unauthorized", "a backend-issued inspector capability on a real FrontendHost connection", "Report frontend activation only through the paired FrontendHost transport.", {
			kind: recordOf(caller).kind,
			sourceId: recordOf(caller).sourceId
		});
	}
	backendSnapshot() {
		let api;
		let state = "unknown";
		try {
			api = safeToolSnapshot(this.toolApi?.snapshot?.());
		} catch (error) {
			state = "unavailable";
			api = {
				providers: [],
				operations: [],
				error: safeError(error)
			};
		}
		const assembly = safeAssembly(this.hostAssembly);
		const fibers = [];
		for (const runtime of this.context?.registry?.values?.() ?? []) for (const fiber of runtime.fibers ?? []) {
			const inspected = inspectPluginFiber(fiber);
			if (inspected.uid !== null) fibers.push({
				...inspected,
				realm: "host"
			});
		}
		if (this.context) state = inspectPluginFiber(this.context.fiber).state;
		const actual = actualPluginEntries(void 0, fibers);
		const activation = {
			state,
			entries: structuredClone(actual)
		};
		return {
			apiVersion: VIEW_INSPECTOR_API_VERSION,
			sourceId: "view-backend",
			kind: "backend",
			generation: (this.hostAssembly && "generation" in this.hostAssembly ? this.hostAssembly.generation : void 0) ?? this.backendSourceGeneration,
			state,
			observedAt: (/* @__PURE__ */ new Date()).toISOString(),
			coverage: {
				assembly: assembly !== null,
				activation: this.context === void 0 ? "unknown" : "actual",
				api: this.toolApi !== void 0,
				frontend: false
			},
			assembly,
			actual: activation,
			api,
			plugins: actual
		};
	}
	frontendSnapshot(record) {
		return {
			apiVersion: VIEW_INSPECTOR_API_VERSION,
			sourceId: record.sourceId,
			kind: "frontend",
			generation: record.generation,
			state: record.state,
			observedAt: record.observedAt,
			connection: record.connection,
			coverage: {
				assembly: record.assembly !== null,
				activation: record.actual?.entries === void 0 ? "unknown" : "actual",
				api: true,
				frontend: true
			},
			assembly: record.assembly,
			actual: record.actual,
			api: record.api,
			plugins: record.plugins
		};
	}
	source(sourceId) {
		if (sourceId === "view-backend") return this.backendSnapshot();
		const report = this.reports.get(sourceId);
		return report === void 0 ? void 0 : this.frontendSnapshot(report);
	}
	requireSource(inputSourceId, generation) {
		const sourceId = requireWorkspaceString(inputSourceId, "sourceId");
		if (typeof generation !== "number" || !Number.isSafeInteger(generation) || generation <= 0) throw workspaceError("view-inspector-generation-required", "source generation to be a positive integer", "Call plugins.sources and pass the generation returned for the selected source.", { sourceId });
		const current = this.source(sourceId);
		if (current === void 0) throw workspaceError("view-inspector-source-unavailable", `source ${sourceId} to be connected and observed`, "Refresh plugins.sources and select an authenticated source that is still connected.", { sourceId });
		if (generation !== current.generation) throw workspaceError("view-inspector-stale-generation", `source ${sourceId} generation ${generation} to match ${current.generation}`, "Refresh plugins.sources before inspecting or watching this source.", {
			sourceId,
			expectedGeneration: current.generation,
			actualGeneration: generation
		});
		return current;
	}
	authorize(request) {
		if (request.token !== this.accessToken) throw workspaceError("view-inspector-unauthorized", "the caller to use the View Host inspector token", "Connect with the token issued by the View Host.", { clientId: request.clientId });
	}
	sources(request) {
		this.authorize(request);
		const backend = this.backendSnapshot();
		const frontend = [...this.reports.values()].map((record) => this.frontendSnapshot(record));
		return {
			apiVersion: VIEW_INSPECTOR_API_VERSION,
			observedAt: (/* @__PURE__ */ new Date()).toISOString(),
			sources: [backend, ...frontend].map((source) => ({
				sourceId: source.sourceId,
				kind: source.kind,
				generation: source.generation,
				state: source.state,
				observedAt: source.observedAt,
				...source.connection === void 0 ? {} : { connection: source.connection },
				coverage: source.coverage,
				pluginCount: Array.isArray(source.plugins) ? source.plugins.length : 0,
				operationCount: source.api?.operations?.length ?? 0
			})),
			caller: {
				connectionId: request.caller?.connectionId,
				kind: request.caller?.kind
			}
		};
	}
	inspect(request) {
		this.authorize(request);
		const source = this.requireSource(request.args.sourceId, request.args.generation);
		const entryId = request.args.entryId;
		if (entryId !== void 0) requireWorkspaceString(entryId, "entryId");
		if (entryId === void 0) return source;
		return {
			...source,
			plugins: source.plugins.filter((entry) => entry.entryId === entryId),
			api: {
				...source.api,
				operations: source.api.operations.filter((operation) => operation.owner?.fiberId === entryId || operation.descriptor?.id === entryId)
			}
		};
	}
	watch(request) {
		this.authorize(request);
		const source = this.requireSource(request.args.sourceId, request.args.generation);
		const watchId = createWorkspaceId("inspector-watch");
		this.watches.set(watchId, {
			watchId,
			sourceId: source.sourceId,
			generation: source.generation,
			connectionId: request.caller.connectionId
		});
		return {
			apiVersion: VIEW_INSPECTOR_API_VERSION,
			watchId,
			topic: VIEW_INSPECTOR_TOPIC,
			source
		};
	}
	unwatch(request) {
		this.authorize(request);
		const watchId = requireWorkspaceString(request.args.watchId, "watchId");
		const watch = this.watches.get(watchId);
		if (watch !== void 0 && watch.connectionId !== request.caller.connectionId) throw workspaceError("view-inspector-unauthorized", "the watch to be owned by the authenticated caller", "Use the watchId returned by this connection.", { watchId });
		this.watches.delete(watchId);
		return {
			apiVersion: VIEW_INSPECTOR_API_VERSION,
			watchId,
			released: true
		};
	}
	async report(request, caller) {
		this.authorize(request);
		this.assertFrontendCaller(caller);
		const sourceId = sourceIdFor(caller);
		const generation = (this.reports.get(sourceId)?.generation ?? 0) + 1;
		const rawReport = request.args?.report ?? {};
		if (!rawReport || typeof rawReport !== "object" || Array.isArray(rawReport)) throw workspaceError("view-inspector-invalid-report", "frontend report to be a structured object", "Send the activation status and safe API projection produced by FrontendHost.");
		const report = recordOf(rawReport);
		const record = {
			sourceId,
			generation,
			state: safeText(recordOf(report.actual).state ?? report.state, "active"),
			observedAt: (/* @__PURE__ */ new Date()).toISOString(),
			connection: {
				connectionId: caller.connectionId,
				kind: caller.kind ?? "unknown"
			},
			assembly: safeAssembly(report.assembly),
			actual: safeActivationStatus(report.actual ?? report.status),
			api: safeToolSnapshot(report.api),
			plugins: actualPluginEntries(report.actual ?? report.status, Array.isArray(report.plugins) ? report.plugins : [])
		};
		this.reports.set(sourceId, record);
		this.publish(sourceId);
		return {
			apiVersion: VIEW_INSPECTOR_API_VERSION,
			sourceId,
			generation
		};
	}
	publish(sourceId) {
		const source = this.source(sourceId);
		if (source === void 0) return;
		for (const [watchId, watch] of this.watches) {
			if (watch.sourceId !== sourceId) continue;
			if (watch.generation !== source.generation) {
				this.transport.publish(VIEW_INSPECTOR_TOPIC, {
					apiVersion: VIEW_INSPECTOR_API_VERSION,
					watchId,
					sourceId,
					state: "stale",
					generation: source.generation,
					reason: "source-generation-changed"
				}, { connectionId: watch.connectionId });
				this.watches.delete(watchId);
				continue;
			}
			this.transport.publish(VIEW_INSPECTOR_TOPIC, {
				apiVersion: VIEW_INSPECTOR_API_VERSION,
				watchId,
				source
			}, { connectionId: watch.connectionId });
		}
	}
	install({ dispatch } = {}) {
		if (typeof dispatch !== "function") throw new TypeError("View inspector requires an Engine ToolApi dispatch adapter");
		const register = (service, operation) => {
			this.disposers.push(this.transport.register(service, ({ payload, signal, caller }) => dispatch({
				operation,
				payload,
				signal,
				caller
			})));
		};
		register(VIEW_INSPECTOR_SERVICES.sources, "plugins.sources");
		register(VIEW_INSPECTOR_SERVICES.inspect, "plugins.inspect");
		register(VIEW_INSPECTOR_SERVICES.watch, "plugins.watch");
		register(VIEW_INSPECTOR_SERVICES.unwatch, "plugins.unwatch");
		register(VIEW_INSPECTOR_SERVICES.report, "plugins.report");
		if (typeof this.toolApi?.subscribe === "function") this.disposers.push(this.toolApi.subscribe(() => this.publish("view-backend")));
		if (typeof this.transport.onClientConnect === "function") this.disposers.push(this.transport.onClientConnect((caller) => {
			if (isAdmittedFrontend(caller)) try {
				this.grantFrontendConnection(caller);
			} catch {}
		}));
		if (typeof this.transport.onClientDisconnect === "function") this.disposers.push(this.transport.onClientDisconnect((caller) => {
			const sourceId = sourceIdFor(caller);
			const report = this.reports.get(sourceId);
			if (report !== void 0) for (const [watchId, watch] of this.watches) {
				if (watch.sourceId !== sourceId || watch.connectionId === caller.connectionId) continue;
				this.transport.publish(VIEW_INSPECTOR_TOPIC, {
					apiVersion: VIEW_INSPECTOR_API_VERSION,
					watchId,
					sourceId,
					state: "stale",
					generation: report.generation + 1,
					reason: "source-disconnected"
				}, { connectionId: watch.connectionId });
				this.watches.delete(watchId);
			}
			this.reports.delete(sourceId);
			this.frontendCapabilities.delete(caller.connectionId);
			for (const [watchId, watch] of this.watches) if (watch.connectionId === caller.connectionId) this.watches.delete(watchId);
		}));
		return () => {
			for (const dispose of this.disposers.splice(0)) dispose?.();
			this.reports.clear();
			this.watches.clear();
			this.frontendCapabilities.clear();
		};
	}
};
var viewInspectorBackendPlugin = {
	name: BACKEND_PLUGIN_ID,
	inject: ["toolApi"],
	provide: ["viewInspector"],
	async apply(ctx, config = {}) {
		const nativeTransport = ctx.get?.("hostTransport", false);
		if (!nativeTransport || !("register" in nativeTransport)) return;
		const broker = new ViewInspectorBroker({
			transport: nativeTransport,
			accessToken: config.accessToken ?? ctx.get?.("viewWorkspaceAccessToken", false),
			hostAssembly: ctx.get?.("hostAssembly", false),
			context: ctx,
			toolApi: ctx.get?.("toolApi", false)
		});
		ctx.provide("viewInspector", broker);
		const inspectorTools = createViewInspectorToolContributions(broker);
		const inspectorProviderId = `view-inspector:${String(ctx.fiber.uid)}`;
		let uninstall;
		let revokeTools;
		ctx.effect(() => async () => {
			await revokeTools?.();
			uninstall?.();
		});
		revokeTools = registerTools(ctx, inspectorTools, {
			providerId: inspectorProviderId,
			sourceId: "view-backend",
			module: BACKEND_MODULE,
			realm: "host"
		});
		const inspectorOwner = ctx.get?.("toolApi", false)?.describe("plugins.sources", "view-backend")?.find((record) => record.owner.providerId === inspectorProviderId)?.owner;
		if (!inspectorOwner) throw new Error("View inspector ToolApi provider did not activate");
		uninstall = broker.install({ dispatch: ({ operation, payload, signal, caller }) => runInspectorToolApi(ctx.get("toolApi"), {
			operation,
			payload,
			signal,
			caller,
			providerId: inspectorOwner.providerId,
			generation: inspectorOwner.generation
		}) });
	}
};
var backend_default = {
	name: BACKEND_PLUGIN_ID,
	inject: ["viewWorkspaceAccessToken", "hostTransport"],
	provide: ["viewInspector"],
	async apply(ctx, config = {}) {
		const accessToken = ctx.get("viewWorkspaceAccessToken");
		if (!accessToken) throw new Error("View plugins-list backend requires the shared workspace session");
		return viewInspectorBackendPlugin.apply(ctx, {
			...config,
			accessToken
		});
	}
};
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-GIGIIRZI.mjs
var RESOURCE_PREVIEW_LAYOUT = Object.freeze({
	dock: "fill",
	stack: "tabs",
	order: 0
});
var RESOURCE_PROPERTIES_LAYOUT = Object.freeze({
	dock: "right",
	size: Object.freeze({
		value: .36,
		unit: "fraction"
	}),
	stack: "tabs",
	order: 1
});
var RESOURCE_FALLBACK_LAYOUT = Object.freeze({
	dock: "fill",
	stack: "tabs",
	order: 0
});
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-IQ6H3GNL.mjs
var identity_exports$11 = {};
__export(identity_exports$11, {
	FRONTEND_MODULE: () => FRONTEND_MODULE$11,
	FRONTEND_PLUGIN_ID: () => FRONTEND_PLUGIN_ID$11,
	PAGE_ORDER: () => 80,
	PAGE_PRIORITY: () => 0,
	PAGE_TITLE_I18N_KEY: () => PAGE_TITLE_I18N_KEY$3,
	PAGE_TYPE: () => PAGE_TYPE$9,
	PLUGIN_ID: () => PLUGIN_ID$7,
	PROPERTIES_ICON: () => PROPERTIES_ICON$3,
	PROPERTIES_LAYOUT: () => PROPERTIES_LAYOUT$3,
	PROPERTIES_PANEL: () => PROPERTIES_PANEL$3,
	PROPERTIES_SLOT: () => PROPERTIES_SLOT$3,
	PROPERTIES_TITLE_I18N_KEY: () => PROPERTIES_TITLE_I18N_KEY$3,
	RESOURCE_SELECTOR: () => RESOURCE_SELECTOR$3
});
var PLUGIN_ID$7 = "forgeax.view.asset";
var FRONTEND_PLUGIN_ID$11 = "forgeax.view.page.asset.frontend";
var FRONTEND_MODULE$11 = "@forgeax/view/plugins/asset/frontend";
var PAGE_TYPE$9 = VIEW_PAGE_TYPES.asset;
var PAGE_TITLE_I18N_KEY$3 = "view.pages.asset";
var PROPERTIES_SLOT$3 = "asset-properties";
var RESOURCE_SELECTOR$3 = Object.freeze({ fallback: true });
var PROPERTIES_LAYOUT$3 = RESOURCE_FALLBACK_LAYOUT;
var PROPERTIES_PANEL$3 = "AssetProperties";
var PROPERTIES_ICON$3 = "detail";
var PROPERTIES_TITLE_I18N_KEY$3 = "view.slots.assetProperties";
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-WNZC7QCA.mjs
var identity_exports$10 = {};
__export(identity_exports$10, {
	FRONTEND_MODULE: () => FRONTEND_MODULE$10,
	FRONTEND_PLUGIN_ID: () => FRONTEND_PLUGIN_ID$10,
	PAGE_TYPE: () => PAGE_TYPE$8
});
var FRONTEND_MODULE$10 = "@forgeax/view/plugins/html/frontend";
var FRONTEND_PLUGIN_ID$10 = "forgeax.view.page.html.frontend";
var PAGE_TYPE$8 = VIEW_PAGE_TYPES.html;
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-MMFN6EDO.mjs
var identity_exports$9 = {};
__export(identity_exports$9, {
	FRONTEND_MODULE: () => FRONTEND_MODULE$9,
	FRONTEND_PLUGIN_ID: () => FRONTEND_PLUGIN_ID$9,
	PAGE_TYPE: () => PAGE_TYPE$7,
	PANEL_LAYOUT: () => PANEL_LAYOUT$4,
	PLUGIN_ID: () => PLUGIN_ID$6,
	SLOT: () => SLOT$4,
	TITLE_I18N_KEY: () => TITLE_I18N_KEY$4
});
var PLUGIN_ID$6 = "forgeax.view.scene-tree";
var FRONTEND_PLUGIN_ID$9 = "forgeax.view.panel.scene-hierarchy.frontend";
var FRONTEND_MODULE$9 = "@forgeax/view/plugins/scene-tree/frontend";
var SLOT$4 = "scene-tree";
var PAGE_TYPE$7 = VIEW_PAGE_TYPES.scene;
var PANEL_LAYOUT$4 = Object.freeze({
	dock: "left",
	size: Object.freeze({
		value: .17,
		unit: "fraction"
	}),
	stack: "tabs",
	order: 0
});
var TITLE_I18N_KEY$4 = "view.slots.sceneTree";
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-H73WFYKU.mjs
var identity_exports$8 = {};
__export(identity_exports$8, {
	FRONTEND_MODULE: () => FRONTEND_MODULE$8,
	FRONTEND_PLUGIN_ID: () => FRONTEND_PLUGIN_ID$8,
	PAGE_TYPE: () => PAGE_TYPE$6,
	PANEL_LAYOUT: () => PANEL_LAYOUT$3,
	PLUGIN_ID: () => PLUGIN_ID$5,
	SLOT: () => SLOT$3,
	TITLE_I18N_KEY: () => TITLE_I18N_KEY$3
});
var PLUGIN_ID$5 = "forgeax.view.inspector";
var FRONTEND_PLUGIN_ID$8 = "forgeax.view.panel.object-inspector.frontend";
var FRONTEND_MODULE$8 = "@forgeax/view/plugins/inspector/frontend";
var SLOT$3 = "inspector";
var PAGE_TYPE$6 = VIEW_PAGE_TYPES.scene;
var PANEL_LAYOUT$3 = Object.freeze({
	dock: "right",
	size: Object.freeze({
		value: .28,
		unit: "fraction"
	}),
	stack: "tabs",
	order: 0
});
var TITLE_I18N_KEY$3 = "view.slots.inspector";
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-3TXQTM4G.mjs
var PARAMETERS_FRONTEND_MODULE = "@forgeax/view-plugin-parameters/frontend";
var PARAMETERS_FRONTEND_PLUGIN_ID = "forgeax.view.panel.parameters.frontend";
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-Z5CLULOU.mjs
var identity_exports$7 = {};
__export(identity_exports$7, {
	FRONTEND_MODULE: () => FRONTEND_MODULE$7,
	FRONTEND_PLUGIN_ID: () => FRONTEND_PLUGIN_ID$7,
	PAGE_TYPE: () => PAGE_TYPE$5
});
var PAGE_TYPE$5 = VIEW_PAGE_TYPES.history;
var FRONTEND_MODULE$7 = "@forgeax/view/plugins/history/frontend";
var FRONTEND_PLUGIN_ID$7 = "forgeax.view.page.history.frontend";
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-B4NPZNXL.mjs
var identity_exports$6 = {};
__export(identity_exports$6, {
	FRONTEND_MODULE: () => FRONTEND_MODULE$6,
	FRONTEND_PLUGIN_ID: () => FRONTEND_PLUGIN_ID$6,
	PANEL_LAYOUT: () => PANEL_LAYOUT$2,
	PLUGIN_ID: () => PLUGIN_ID$4,
	SLOT: () => SLOT$2,
	TITLE_I18N_KEY: () => TITLE_I18N_KEY$2
});
var PLUGIN_ID$4 = "forgeax.view.content-browser";
var FRONTEND_PLUGIN_ID$6 = "forgeax.view.panel.asset-browser.frontend";
var FRONTEND_MODULE$6 = "@forgeax/view/plugins/content-browser/frontend";
var SLOT$2 = "content-browser";
var PANEL_LAYOUT$2 = Object.freeze({ order: 0 });
var TITLE_I18N_KEY$2 = "view.slots.contentBrowser";
__export({}, {
	FRONTEND_MODULE: () => FRONTEND_MODULE$5,
	FRONTEND_PLUGIN_ID: () => FRONTEND_PLUGIN_ID$5
});
var FRONTEND_PLUGIN_ID$5 = "forgeax.view.service.asset-references.frontend";
var FRONTEND_MODULE$5 = "@forgeax/view/plugins/asset-references/frontend";
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-AFREYDIH.mjs
var identity_exports$4 = {};
__export(identity_exports$4, {
	FRONTEND_MODULE: () => FRONTEND_MODULE$4,
	FRONTEND_PLUGIN_ID: () => FRONTEND_PLUGIN_ID$4,
	PAGE_TYPE: () => PAGE_TYPE$4,
	PANEL_CLOSABLE: () => false,
	PANEL_LAYOUT: () => PANEL_LAYOUT$1,
	PLUGIN_ID: () => PLUGIN_ID$3,
	SLOT: () => SLOT$1,
	TITLE_I18N_KEY: () => TITLE_I18N_KEY$1,
	VIEWPORT_SURFACE_ID: () => VIEWPORT_SURFACE_ID,
	VIEWPORT_TARGET_ROLE: () => VIEWPORT_TARGET_ROLE
});
var PLUGIN_ID$3 = "forgeax.view.viewport";
var FRONTEND_PLUGIN_ID$4 = "forgeax.view.panel.scene-viewport.frontend";
var FRONTEND_MODULE$4 = "@forgeax/view/plugins/viewport/frontend";
var SLOT$1 = "viewport";
var PAGE_TYPE$4 = VIEW_PAGE_TYPES.scene;
var PANEL_LAYOUT$1 = Object.freeze({
	dock: "fill",
	stack: "tabs",
	order: 0
});
var TITLE_I18N_KEY$1 = "view.slots.viewport";
var VIEWPORT_SURFACE_ID = "forgeax-view-viewport-surface";
var VIEWPORT_TARGET_ROLE = "human-readonly";
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-IZAX2KNQ.mjs
var identity_exports$3 = {};
__export(identity_exports$3, {
	FRONTEND_MODULE: () => FRONTEND_MODULE$3,
	FRONTEND_PLUGIN_ID: () => FRONTEND_PLUGIN_ID$3,
	PAGE_ORDER: () => 32,
	PAGE_PRIORITY: () => 20,
	PAGE_TITLE_I18N_KEY: () => PAGE_TITLE_I18N_KEY$2,
	PAGE_TYPE: () => PAGE_TYPE$3,
	PLUGIN_ID: () => PLUGIN_ID$2,
	PREVIEW_ICON: () => PREVIEW_ICON$2,
	PREVIEW_LAYOUT: () => PREVIEW_LAYOUT$2,
	PREVIEW_PANEL: () => PREVIEW_PANEL$2,
	PREVIEW_SLOT: () => PREVIEW_SLOT$2,
	PREVIEW_TITLE_I18N_KEY: () => PREVIEW_TITLE_I18N_KEY$2,
	PROPERTIES_ICON: () => PROPERTIES_ICON$2,
	PROPERTIES_LAYOUT: () => PROPERTIES_LAYOUT$2,
	PROPERTIES_PANEL: () => PROPERTIES_PANEL$2,
	PROPERTIES_SLOT: () => PROPERTIES_SLOT$2,
	PROPERTIES_TITLE_I18N_KEY: () => PROPERTIES_TITLE_I18N_KEY$2,
	RESOURCE_KINDS: () => RESOURCE_KINDS$2,
	RESOURCE_SELECTOR: () => RESOURCE_SELECTOR$2
});
var PLUGIN_ID$2 = "forgeax.view.texture";
var FRONTEND_PLUGIN_ID$3 = "forgeax.view.page.texture.frontend";
var FRONTEND_MODULE$3 = "@forgeax/view/plugins/texture/frontend";
var PAGE_TYPE$3 = VIEW_PAGE_TYPES.texture;
var PAGE_TITLE_I18N_KEY$2 = "view.pages.texture";
var PREVIEW_SLOT$2 = "texture-preview";
var PROPERTIES_SLOT$2 = "texture-properties";
var RESOURCE_KINDS$2 = Object.freeze([
	"texture",
	"image",
	"equirect"
]);
var RESOURCE_SELECTOR$2 = Object.freeze({ kinds: RESOURCE_KINDS$2 });
var PREVIEW_LAYOUT$2 = RESOURCE_PREVIEW_LAYOUT;
var PROPERTIES_LAYOUT$2 = RESOURCE_PROPERTIES_LAYOUT;
var PREVIEW_PANEL$2 = "TexturePreview";
var PROPERTIES_PANEL$2 = "TextureProperties";
var PREVIEW_ICON$2 = "image";
var PROPERTIES_ICON$2 = "detail";
var PREVIEW_TITLE_I18N_KEY$2 = "view.slots.texturePreview";
var PROPERTIES_TITLE_I18N_KEY$2 = "view.slots.textureProperties";
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-GAGR2BRM.mjs
var identity_exports$2 = {};
__export(identity_exports$2, {
	FRONTEND_MODULE: () => FRONTEND_MODULE$2,
	FRONTEND_PLUGIN_ID: () => FRONTEND_PLUGIN_ID$2,
	PAGE_ORDER: () => 30,
	PAGE_PRIORITY: () => 20,
	PAGE_TITLE_I18N_KEY: () => PAGE_TITLE_I18N_KEY$1,
	PAGE_TYPE: () => PAGE_TYPE$2,
	PANEL_LAYOUT: () => PANEL_LAYOUT,
	PLUGIN_ID: () => PLUGIN_ID$1,
	PREVIEW_ICON: () => PREVIEW_ICON$1,
	PREVIEW_LAYOUT: () => PREVIEW_LAYOUT$1,
	PREVIEW_PANEL: () => PREVIEW_PANEL$1,
	PREVIEW_SLOT: () => PREVIEW_SLOT$1,
	PREVIEW_TITLE_I18N_KEY: () => PREVIEW_TITLE_I18N_KEY$1,
	PROPERTIES_ICON: () => PROPERTIES_ICON$1,
	PROPERTIES_LAYOUT: () => PROPERTIES_LAYOUT$1,
	PROPERTIES_PANEL: () => PROPERTIES_PANEL$1,
	PROPERTIES_SLOT: () => PROPERTIES_SLOT$1,
	PROPERTIES_TITLE_I18N_KEY: () => PROPERTIES_TITLE_I18N_KEY$1,
	RESOURCE_KINDS: () => RESOURCE_KINDS$1,
	RESOURCE_SELECTOR: () => RESOURCE_SELECTOR$1,
	SLOT: () => SLOT,
	STATS_SLOT: () => STATS_SLOT,
	TITLE_I18N_KEY: () => TITLE_I18N_KEY
});
var PLUGIN_ID$1 = "forgeax.view.material";
var FRONTEND_PLUGIN_ID$2 = "forgeax.view.page.material.frontend";
var FRONTEND_MODULE$2 = "@forgeax/view/plugins/material/frontend";
var PAGE_TYPE$2 = VIEW_PAGE_TYPES.material;
var PAGE_TITLE_I18N_KEY$1 = "view.pages.material";
var PREVIEW_SLOT$1 = "material-preview";
var PROPERTIES_SLOT$1 = "material-properties";
var STATS_SLOT = "material-stats";
var SLOT = PROPERTIES_SLOT$1;
var RESOURCE_KINDS$1 = Object.freeze(["material"]);
var RESOURCE_SELECTOR$1 = Object.freeze({ kinds: RESOURCE_KINDS$1 });
var PREVIEW_LAYOUT$1 = RESOURCE_PREVIEW_LAYOUT;
var PROPERTIES_LAYOUT$1 = RESOURCE_PROPERTIES_LAYOUT;
var PANEL_LAYOUT = PROPERTIES_LAYOUT$1;
var PREVIEW_PANEL$1 = "MaterialPreview";
var PROPERTIES_PANEL$1 = "MaterialProperties";
var PREVIEW_ICON$1 = "sparkle";
var PROPERTIES_ICON$1 = "sliders";
var PREVIEW_TITLE_I18N_KEY$1 = "view.slots.materialPreview";
var PROPERTIES_TITLE_I18N_KEY$1 = "view.slots.materialProperties";
var TITLE_I18N_KEY = PROPERTIES_TITLE_I18N_KEY$1;
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-FDQITXHD.mjs
var identity_exports$1 = {};
__export(identity_exports$1, {
	FRONTEND_MODULE: () => FRONTEND_MODULE$1,
	FRONTEND_PLUGIN_ID: () => FRONTEND_PLUGIN_ID$1,
	PAGE_ORDER: () => 31,
	PAGE_PRIORITY: () => 20,
	PAGE_TITLE_I18N_KEY: () => PAGE_TITLE_I18N_KEY,
	PAGE_TYPE: () => PAGE_TYPE$1,
	PLUGIN_ID: () => PLUGIN_ID,
	PREVIEW_ICON: () => "box",
	PREVIEW_LAYOUT: () => PREVIEW_LAYOUT,
	PREVIEW_PANEL: () => PREVIEW_PANEL,
	PREVIEW_SLOT: () => PREVIEW_SLOT,
	PREVIEW_TITLE_I18N_KEY: () => PREVIEW_TITLE_I18N_KEY,
	PROPERTIES_ICON: () => PROPERTIES_ICON,
	PROPERTIES_LAYOUT: () => PROPERTIES_LAYOUT,
	PROPERTIES_PANEL: () => PROPERTIES_PANEL,
	PROPERTIES_SLOT: () => PROPERTIES_SLOT,
	PROPERTIES_TITLE_I18N_KEY: () => PROPERTIES_TITLE_I18N_KEY,
	RESOURCE_KINDS: () => RESOURCE_KINDS,
	RESOURCE_SELECTOR: () => RESOURCE_SELECTOR
});
var PLUGIN_ID = "forgeax.view.mesh";
var FRONTEND_PLUGIN_ID$1 = "forgeax.view.page.mesh.frontend";
var FRONTEND_MODULE$1 = "@forgeax/view/plugins/mesh/frontend";
var PAGE_TYPE$1 = VIEW_PAGE_TYPES.mesh;
var PAGE_TITLE_I18N_KEY = "view.pages.mesh";
var PREVIEW_SLOT = "mesh-preview";
var PROPERTIES_SLOT = "mesh-properties";
var RESOURCE_KINDS = Object.freeze(["mesh"]);
var RESOURCE_SELECTOR = Object.freeze({ kinds: RESOURCE_KINDS });
var PREVIEW_LAYOUT = RESOURCE_PREVIEW_LAYOUT;
var PROPERTIES_LAYOUT = RESOURCE_PROPERTIES_LAYOUT;
var PREVIEW_PANEL = "MeshPreview";
var PROPERTIES_PANEL = "MeshProperties";
var PROPERTIES_ICON = "detail";
var PREVIEW_TITLE_I18N_KEY = "view.slots.meshPreview";
var PROPERTIES_TITLE_I18N_KEY = "view.slots.meshProperties";
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-J5B4LX5H.mjs
var PRESENTATION_PLUGIN_ID = "forgeax.view.service.play-presentation.frontend";
var PRESENTATION_MODULE = "@forgeax/view/workspace/presentation";
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-QEPH632I.mjs
var identity_exports = {};
__export(identity_exports, {
	FRONTEND_MODULE: () => FRONTEND_MODULE,
	FRONTEND_PLUGIN_ID: () => FRONTEND_PLUGIN_ID,
	PAGE_TYPE: () => PAGE_TYPE
});
var FRONTEND_PLUGIN_ID = "forgeax.view.page.scene.frontend";
var FRONTEND_MODULE = "@forgeax/view/pages/scene";
var PAGE_TYPE = VIEW_PAGE_TYPES.scene;
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-QAXALJEY.mjs
var SHELL_PLUGIN_ID = "forgeax.view.shell.workspace.frontend";
var SHELL_MODULE = "@forgeax/view/shell/frontend";
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-6U4QXUTY.mjs
var revision_default = "4bd12d8f5e9542a66f00266190a2d8558692a1bdccec2ac491ae6434276c869c";
var VIEW_PLUGIN_VERSION = "0.2.0";
var VIEW_FRONTEND_ROOT_PROGRAM = "@forgeax/view/frontend-root";
var VIEW_FRONTEND_MODULE = Object.freeze({ specifier: VIEW_FRONTEND_ROOT_PROGRAM });
function viewFrontendRoot(frontendConfig, disabledPages = []) {
	return Object.freeze({
		program: VIEW_FRONTEND_ROOT_PROGRAM,
		codeRevision: revision_default,
		config: {
			frontendConfig,
			disabledPages
		}
	});
}
var VIEW_WORKSPACE_CORE = Object.freeze({
	BACKEND_PLUGIN_ID: "forgeax.view.service.workspace.backend",
	FRONTEND_PLUGIN_ID: "forgeax.view.service.workspace-client.frontend",
	BACKEND_MODULE: "@forgeax/view-workspace-core/backend",
	FRONTEND_MODULE: "@forgeax/view/workspace-frontend"
});
var VIEW_PRODUCT_PLUGINS = Object.freeze([
	identity_exports,
	identity_exports$13,
	identity_exports$4,
	identity_exports$6,
	identity_exports$12,
	identity_exports$8,
	identity_exports$9,
	identity_exports$2,
	identity_exports$1,
	identity_exports$3,
	identity_exports$11,
	identity_exports$10,
	identity_exports$7
]);
function isPagePlugin(plugin) {
	return "PAGE_TYPE" in plugin && typeof plugin.PAGE_TYPE === "string";
}
var VIEW_CAPABILITY_FRONTEND_PLUGINS = Object.freeze([Object.freeze({
	FRONTEND_PLUGIN_ID: PARAMETERS_FRONTEND_PLUGIN_ID,
	FRONTEND_MODULE: PARAMETERS_FRONTEND_MODULE
})]);
function createViewProductPlan({ backendConfig, frontendConfig, disabledPages = [] } = {}) {
	const pages = new Set(VIEW_PRODUCT_PLUGINS.filter(isPagePlugin).map((plugin) => plugin.PAGE_TYPE));
	for (const page of disabledPages) if (!pages.has(page)) throw new TypeError(`Unknown View page: ${page}`);
	const disabled = new Set(disabledPages);
	const displayBackendConfig = {
		platform: backendConfig?.platform,
		capabilities: backendConfig?.capabilities
	};
	const workspaceBackendConfig = {
		workspaceEngine: backendConfig?.workspaceEngine,
		workspaceAccessToken: backendConfig?.workspaceAccessToken,
		workspaceAuthorize: backendConfig?.workspaceAuthorize,
		packSources: backendConfig?.packSources,
		capabilities: backendConfig?.capabilities
	};
	const backend = [
		{
			id: VIEW_WORKSPACE_CORE.BACKEND_PLUGIN_ID,
			module: VIEW_WORKSPACE_CORE.BACKEND_MODULE,
			config: workspaceBackendConfig
		},
		{
			id: BACKEND_PLUGIN_ID$1,
			module: BACKEND_MODULE$1,
			config: displayBackendConfig
		},
		{
			id: BACKEND_PLUGIN_ID,
			module: BACKEND_MODULE,
			config: {}
		}
	];
	const frontend = [
		{
			id: SHELL_PLUGIN_ID,
			module: SHELL_MODULE
		},
		{
			id: VIEW_WORKSPACE_CORE.FRONTEND_PLUGIN_ID,
			module: VIEW_WORKSPACE_CORE.FRONTEND_MODULE
		},
		{
			id: FRONTEND_PLUGIN_ID$5,
			module: FRONTEND_MODULE$5
		},
		...!disabled.has(PAGE_TYPE) ? [{
			id: FRONTEND_PLUGIN_ID,
			module: FRONTEND_MODULE
		}] : [],
		{
			id: PRESENTATION_PLUGIN_ID,
			module: PRESENTATION_MODULE
		},
		...VIEW_PRODUCT_PLUGINS.filter((plugin) => plugin !== identity_exports && (!isPagePlugin(plugin) || !disabled.has(plugin.PAGE_TYPE))).map((plugin) => ({
			id: plugin.FRONTEND_PLUGIN_ID,
			module: plugin.FRONTEND_MODULE
		})),
		...VIEW_CAPABILITY_FRONTEND_PLUGINS.map((plugin) => ({
			id: plugin.FRONTEND_PLUGIN_ID,
			module: plugin.FRONTEND_MODULE
		}))
	];
	return Object.freeze({
		backend: Object.freeze(backend),
		frontend: Object.freeze(frontend),
		frontendConfig,
		disabledPages: Object.freeze([...disabled])
	});
}
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-GUIQB2GB.mjs
var implementations = /* @__PURE__ */ new Map([
	[VIEW_WORKSPACE_CORE.BACKEND_MODULE, backend_default$1],
	[BACKEND_MODULE$1, backend_default$2],
	[BACKEND_MODULE, backend_default]
]);
var VIEW_PRODUCT_BACKEND_CATALOG = new Map([VIEW_WORKSPACE_CORE, ...VIEW_PRODUCT_PLUGINS].filter((plugin) => "BACKEND_MODULE" in plugin).map((plugin) => [plugin.BACKEND_MODULE, {
	realm: "host",
	version: VIEW_PLUGIN_VERSION,
	load: async () => {
		const implementation = implementations.get(plugin.BACKEND_MODULE);
		if (!implementation) throw new Error(`View backend implementation is missing: ${plugin.BACKEND_MODULE}`);
		return { default: implementation };
	}
}]));
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-4A2JFJRI.mjs
var ENGINE_PACKAGE_ASSET = /^\/assets\/engine\/([a-z0-9-]+)\/[\w-]+\/([\w-]+(?:\.[\w-]+)+)$/;
var STATIC_MIME = Object.freeze({
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".json": "application/json; charset=utf-8",
	".wasm": "application/wasm"
});
function viewerContentType(filePath) {
	const index = filePath.lastIndexOf(".");
	if (index === -1) return "application/octet-stream";
	return STATIC_MIME[filePath.slice(index)] ?? "application/octet-stream";
}
function regularFile(path) {
	return existsSync(path) && statSync(path).isFile() ? path : void 0;
}
function resolveViewerFile(staticRoot, pathname, engineRoot) {
	const engineAsset = ENGINE_PACKAGE_ASSET.exec(pathname);
	if (engineAsset !== null) {
		const [, directory, file] = engineAsset;
		return engineRoot === void 0 ? void 0 : regularFile(join(engineRoot, "node_modules", "@forgeax", `engine-${directory}`, "pkg", file));
	}
	const relative = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
	const absolute = join(staticRoot, relative);
	if (!absolute.startsWith(staticRoot)) return void 0;
	return regularFile(absolute);
}
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-JFJIVWGR.mjs
var DEFAULT_PATH = "/__forgeax/view-workspace";
var BOOTSTRAP_PATH = "/__forgeax/view/bootstrap";
function isLoopbackHost(host) {
	const normalized = host.toLowerCase().replace(/^\[(.*)\]$/, "$1");
	return normalized === "localhost" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1" || normalized.startsWith("127.");
}
function rejectUpgrade(socket, status, message) {
	try {
		socket.write(`HTTP/1.1 ${status}\r
Connection: close\r
Content-Length: ${Buffer.byteLength(message)}\r
\r
${message}`);
	} finally {
		socket.destroy();
	}
}
function endpointWithToken(endpoint, token, role) {
	const url = new URL(endpoint);
	url.searchParams.set("token", requireWorkspaceString(token, "token"));
	if (role === "frontend") url.searchParams.set("role", role);
	else {
		url.searchParams.delete("role");
		url.searchParams.delete("frontendTicket");
		if (role !== void 0) url.searchParams.set("role", role);
	}
	return url.toString();
}
async function startViewHostServer({ backendHost, transport = backendHost?.transport, accessToken, host = "127.0.0.1", port = 0, path = DEFAULT_PATH, frontendSourceId = "view-frontend", onClientConnect, onClientDisconnect, staticRoot, engineRoot, frontendConfig } = {}) {
	if (!transport || typeof transport.connect !== "function") throw new TypeError("resident View Host requires an Engine Host transport");
	const token = requireWorkspaceString(accessToken, "accessToken");
	const frontendTicket = randomUUID();
	if (typeof host !== "string" || host.length === 0) throw new TypeError("resident View Host requires a host");
	if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new TypeError("resident View Host port must be an integer from 0 to 65535");
	if (typeof path !== "string" || !path.startsWith("/")) throw new TypeError("resident View Host path must start with /");
	const staticRootPath = staticRoot === void 0 ? void 0 : typeof staticRoot === "string" ? staticRoot : fileURLToPath(staticRoot);
	if (staticRootPath && !isLoopbackHost(host)) throw new Error("The View browser bootstrap contains host credentials and may only bind to a loopback host");
	const http = createServer((request, response) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		if (url.pathname === "/__forgeax/view/health") {
			response.writeHead(204, {
				"Access-Control-Allow-Origin": "*",
				"Cross-Origin-Resource-Policy": "cross-origin",
				"Cache-Control": "no-store"
			});
			response.end();
			return;
		}
		if (url.pathname === BOOTSTRAP_PATH) {
			const address2 = http.address();
			const selectedPort2 = typeof address2 === "object" && address2 !== null ? address2.port : port;
			const endpoint2 = `ws://${host === "0.0.0.0" ? "127.0.0.1" : host}:${selectedPort2}${path}`;
			const frontendEndpoint2 = `${endpoint2}?frontendTicket=${encodeURIComponent(frontendTicket)}`;
			response.statusCode = 200;
			response.setHeader("Content-Type", "application/json; charset=utf-8");
			response.setHeader("Cache-Control", "no-store");
			response.end(JSON.stringify({
				token,
				endpoint: endpoint2,
				frontendEndpoint: frontendEndpoint2,
				frontendTicket,
				workspacePath: path,
				...frontendConfig?.layout === void 0 ? {} : { frontendConfig: { layout: frontendConfig.layout } }
			}));
			return;
		}
		if (!staticRootPath) {
			response.statusCode = 404;
			response.end("View workspace WebSocket endpoint only");
			return;
		}
		const filePath = resolveViewerFile(staticRootPath, url.pathname === "/" ? "/index.html" : url.pathname, engineRoot);
		if (filePath) {
			response.statusCode = 200;
			response.setHeader("Content-Type", viewerContentType(filePath));
			createReadStream(filePath).pipe(response);
			return;
		}
		const spa = resolveViewerFile(staticRootPath, "/index.html");
		if (spa) {
			response.statusCode = 200;
			response.setHeader("Content-Type", "text/html; charset=utf-8");
			createReadStream(spa).pipe(response);
			return;
		}
		response.statusCode = 404;
		response.end("Not found");
	});
	const sockets = /* @__PURE__ */ new Set();
	const disposers = /* @__PURE__ */ new Set();
	const isTrustedFrontendCaller = (caller) => caller?.kind === "frontend" && caller?.sourceId === frontendSourceId;
	const notify = (callback, caller) => {
		try {
			Promise.resolve(callback?.(caller)).catch(() => {});
		} catch {}
	};
	const removeTransportConnect = transport.onClientConnect?.((caller) => {
		if (isTrustedFrontendCaller(caller)) notify(onClientConnect, caller);
	});
	const removeTransportDisconnect = transport.onClientDisconnect?.((caller) => {
		if (caller?.kind === "websocket" || isTrustedFrontendCaller(caller)) notify(onClientDisconnect, caller);
	});
	const socketServer = new WebSocketServer({ noServer: true });
	let closed = false;
	const onUpgrade = (request, socket, head) => {
		if (closed) return rejectUpgrade(socket, "503 Service Unavailable", "View Host is stopping");
		let url;
		try {
			url = new URL(request.url ?? "/", "http://127.0.0.1");
		} catch {
			return rejectUpgrade(socket, "400 Bad Request", "Invalid View Host request");
		}
		if (url.pathname !== path) return;
		if (url.searchParams.get("token") !== token) return rejectUpgrade(socket, "401 Unauthorized", "View Host token rejected");
		const trustedFrontend = url.searchParams.get("role") === "frontend" && url.searchParams.get("frontendTicket") === frontendTicket;
		socketServer.handleUpgrade(request, socket, head, (client) => {
			client.__forgeaxHostRole = trustedFrontend ? "frontend" : "websocket";
			socketServer.emit("connection", client, request);
		});
	};
	const onConnection = (socket) => {
		sockets.add(socket);
		const role = socket.__forgeaxHostRole;
		const dispose = attachHostWebSocketServer(socket, transport, role === "frontend" ? {
			kind: "frontend",
			sourceId: frontendSourceId
		} : { kind: "websocket" });
		disposers.add(dispose);
		const remove = () => {
			sockets.delete(socket);
			disposers.delete(dispose);
		};
		socket.once?.("close", remove);
		socket.once?.("error", remove);
	};
	socketServer.on("connection", onConnection);
	http.on("upgrade", onUpgrade);
	await new Promise((resolve, reject) => {
		const onError = (error) => {
			http.off("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			http.off("error", onError);
			resolve();
		};
		http.once("error", onError);
		http.once("listening", onListening);
		http.listen(port, host);
	});
	const address = http.address();
	const selectedPort = typeof address === "object" && address !== null ? address.port : port;
	const endpoint = `ws://${host === "0.0.0.0" ? "127.0.0.1" : host}:${selectedPort}${path}`;
	const frontendEndpoint = `${endpoint}?frontendTicket=${encodeURIComponent(frontendTicket)}`;
	let closing;
	const close = (reason = "resident View Host stopped") => closing ??= (async () => {
		closed = true;
		removeTransportConnect?.();
		removeTransportDisconnect?.();
		http.off("upgrade", onUpgrade);
		for (const dispose of [...disposers]) dispose();
		disposers.clear();
		for (const socket of [...sockets]) socket.terminate();
		sockets.clear();
		const failures = (await Promise.allSettled([new Promise((resolve, reject) => {
			socketServer.close((error) => error ? reject(error) : resolve());
		}), new Promise((resolve, reject) => {
			if (!http.listening) return resolve();
			http.close((error) => error ? reject(error) : resolve());
		})])).filter((result) => result.status === "rejected").map((result) => result.reason);
		if (failures.length) throw new AggregateError(failures, "View server cleanup failed");
	})();
	const httpUrl = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${selectedPort}`;
	return Object.freeze({
		host,
		port: selectedPort,
		path,
		token,
		endpoint,
		url: endpointWithToken(endpoint, token),
		frontendEndpoint,
		frontendUrl: endpointWithToken(frontendEndpoint, token, "frontend"),
		frontendTicket,
		server: http,
		socketServer,
		...staticRootPath ? {
			viewerUrl: httpUrl,
			bootstrapUrl: `${httpUrl}${BOOTSTRAP_PATH}`
		} : {},
		close
	});
}
// ../tiangong-tools/forgeax-sdk-0.4.19/.forgeax/cli-runtime/node_modules/.pnpm/@forgeax+view@file+..+..+to_b3a852a671f9a708395597688c2ba41a/node_modules/@forgeax/view/dist/modules/chunks/chunk-U7ZABW3B.mjs
var ownerArgs = toolJsonSchema({
	type: "object",
	properties: { root: { type: "string" } },
	additionalProperties: false
});
var startArgs = toolJsonSchema({
	type: "object",
	properties: {
		root: { type: "string" },
		project: { type: "string" },
		frontendConfig: viewStartFrontendConfigSchema
	},
	additionalProperties: false
});
var projectOpenSchema = {
	type: "object",
	properties: {
		root: { type: "string" },
		project: { type: "string" }
	},
	required: ["project"],
	additionalProperties: false
};
function readWorkspaceCore(owner) {
	if (!owner || typeof owner.get !== "function") return void 0;
	try {
		const value = owner.get("viewWorkspaceCore", false);
		return value && typeof value.openProject === "function" && typeof value.snapshot === "function" ? value : void 0;
	} catch {
		return;
	}
}
function installedViewStaticRoot(projectRoot) {
	try {
		const pluginEntry = createRequire(join(projectRoot, "forge.json")).resolve("@forgeax/view/plugin");
		const staticRoot = resolve(dirname(pluginEntry), "../viewer");
		return existsSync(join(staticRoot, "index.html")) ? staticRoot : void 0;
	} catch {
		return;
	}
}
function projectFailure(error) {
	const record = workspaceDiagnosticRecord(error);
	const hint = typeof record.hint === "string" ? record.hint : typeof record.message === "string" ? record.message : String(error);
	return {
		ok: false,
		error: {
			code: typeof record.code === "string" ? record.code : "view-project-open-failed",
			expected: typeof record.expected === "string" ? record.expected : hint,
			hint,
			...record.detail === void 0 ? {} : { detail: record.detail }
		}
	};
}
function projectSuccess(body) {
	return {
		ok: true,
		value: {
			ok: true,
			alreadyOpen: body.alreadyOpen === true,
			...body.viewerUrl === void 0 ? {} : { viewerUrl: body.viewerUrl },
			project: body.project,
			projectTarget: body.projectTarget
		}
	};
}
var product_default = {
	name: "forgeax.view",
	inject: [
		"devkitBackend",
		"engineWorkspace",
		"toolApi"
	],
	async apply(ctx, config = {}) {
		const { host } = ctx.devkitBackend;
		let fiber;
		let server;
		let serverEffect;
		let failure;
		const failed = (error) => {
			const record = workspaceDiagnosticRecord(error);
			return {
				code: typeof record.code === "string" ? record.code : "view-cleanup-failed",
				expected: typeof record.expected === "string" ? record.expected : "View-owned contributions to finish cleanup",
				hint: typeof record.hint === "string" ? record.hint : typeof record.message === "string" ? record.message : String(error),
				cleanup: workspaceDiagnosticRecord(record.detail).cleanup ?? "failed"
			};
		};
		let workspaceCore;
		let openAbort;
		let sessionEpoch = 0;
		let queue = Promise.resolve();
		const enqueue = (execute) => {
			const result = queue.then(execute);
			queue = result.catch(() => {});
			return result;
		};
		const status = () => failure ? {
			phase: "failed",
			error: failure
		} : {
			phase: server ? "ready" : "stopped",
			...server ? {
				url: server.viewerUrl,
				presentationId: createHash("sha256").update(server.frontendTicket).digest("hex")
			} : {}
		};
		const stop = async () => {
			if (failure) throw new Error(`${failure.code}: ${failure.hint}`);
			sessionEpoch += 1;
			openAbort?.abort();
			openAbort = void 0;
			workspaceCore = void 0;
			try {
				await serverEffect?.();
				await server?.close();
				await fiber?.dispose();
			} catch (error) {
				failure = failed(error);
				throw error;
			}
			fiber = void 0;
			server = void 0;
			return status();
		};
		const start = async (args = {}) => {
			if (failure) throw new Error(`${failure.code}: ${failure.hint}`);
			const project = resolveProjectIntent(args.project === void 0 ? [] : ["--project", args.project], ctx.devkitBackend.root);
			if (fiber) return withProjectIntent(status(), project);
			const token = randomUUID();
			const workspaceClient = {
				clientId: "view-frontend",
				token,
				resourceBrowser: true
			};
			const layout = args.frontendConfig?.layout ?? config.frontendConfig?.layout;
			const frontendConfig = {
				embedded: true,
				workspace: workspaceClient,
				...layout === void 0 ? {} : { layout }
			};
			const plan = createViewProductPlan({
				disabledPages: config.disabledPages,
				backendConfig: {
					workspaceAccessToken: token,
					packSources: (root, assetRoots) => listPackSources(root, 200, assetRoots)
				},
				frontendConfig
			});
			const started = await startNativePlugin(ctx, {
				name: "forgeax.view.product",
				provide: ["devkitWorkspaceFrontend"],
				async apply(owner) {
					for (const component of plan.backend) {
						const record = VIEW_PRODUCT_BACKEND_CATALOG.get(component.module);
						if (!record) throw new Error(`View backend program is missing: ${component.module}`);
						const module = await record.load();
						await (await owner.plugin(module.default, component.config)).await();
					}
					const builtRoot = config.staticRoot ? void 0 : installedViewStaticRoot(ctx.devkitBackend.hostPackageRoot ?? ctx.devkitBackend.root);
					if (!config.staticRoot && !builtRoot) throw new Error("View UI is not built. Build or install the View package before starting it.");
					workspaceCore = readWorkspaceCore(owner);
					const core = workspaceCore;
					serverEffect = owner.effect(async () => {
						const ownedServer = await startViewHostServer({
							...config.port === void 0 ? {} : { port: config.port },
							backendHost: host,
							accessToken: token,
							staticRoot: config.staticRoot ?? builtRoot,
							engineRoot: installedEngineRoot(),
							frontendConfig,
							...core === void 0 ? {} : {
								onClientConnect: (caller) => core.attachPageSession(caller, host.transport),
								onClientDisconnect: (caller) => core.revokeConnection(caller.connectionId)
							}
						});
						server = ownedServer;
						return () => ownedServer.close();
					});
					await serverEffect;
					Object.assign(workspaceClient, {
						endpoint: server.frontendEndpoint,
						frontendTicket: server.frontendTicket
					});
					const frontendRoot = viewFrontendRoot(frontendConfig, plan.disabledPages);
					const assembly = createHostAssembly({ root: frontendRoot });
					const targetAssembly = config.frontend ? createHostAssembly({ root: {
						...frontendRoot,
						...config.frontend.root,
						config: frontendRoot.config
					} }) : assembly;
					owner.provide("devkitWorkspaceFrontend", {
						assembly: targetAssembly,
						module: config.frontend?.module ?? VIEW_FRONTEND_MODULE
					});
					const removeAdmission = host.transport.onClientConnect((caller) => {
						if (caller.kind === "frontend" && caller.sourceId === "view-frontend") host.bindProjection(caller, { assembly });
					});
					owner.effect(() => removeAdmission);
				}
			});
			if (!started.ok) {
				workspaceCore = void 0;
				if (workspaceDiagnosticRecord(started.error.detail).cleanup !== "completed") failure = failed(started.error);
				else server = void 0;
				throw Object.assign(/* @__PURE__ */ new Error(`${started.error.code}: ${started.error.hint}`), started.error);
			}
			fiber = started.value;
			return withProjectIntent(status(), project);
		};
		const openProject = async (args = {}, epoch = sessionEpoch) => {
			const stopped = () => projectFailure(viewProjectOpenError("view-not-started", "View has stopped. Run forgeax view start again when needed."));
			if (epoch !== sessionEpoch || !server || !workspaceCore) return projectFailure(viewProjectOpenError("view-not-started", epoch !== sessionEpoch ? "View has stopped. Run forgeax view start again when needed." : "Run forgeax backend start, then forgeax view start."));
			const project = typeof args.project === "string" ? args.project : "";
			const controller = new AbortController();
			openAbort = controller;
			try {
				if (epoch !== sessionEpoch || controller.signal.aborted) return stopped();
				const body = await openViewProject(workspaceCore, project, {
					signal: controller.signal,
					viewerUrl: server.viewerUrl
				});
				if (epoch !== sessionEpoch || controller.signal.aborted) return stopped();
				return projectSuccess(body);
			} catch (error) {
				if (epoch !== sessionEpoch || controller.signal.aborted) return stopped();
				return projectFailure(error);
			} finally {
				if (openAbort === controller) openAbort = void 0;
			}
		};
		const lifecycleTool = (operation, execute, { before, argsSchema = ownerArgs } = {}) => defineTool({
			id: `view.${operation}`,
			path: ["view", operation],
			title: `View ${operation}`,
			summary: `${operation} the optional View interface on the existing Engine backend.`,
			realm: "host",
			argsSchema,
			resultSchema: toolJsonSchema({ type: "object" }),
			inputSchema: { type: "object" },
			outputSchema: { type: "object" },
			evidence: []
		}, (args) => {
			before?.();
			return enqueue(() => execute(args));
		});
		const tools = [
			lifecycleTool("start", start, { argsSchema: startArgs }),
			lifecycleTool("status", status),
			lifecycleTool("stop", stop, { before: () => {
				sessionEpoch += 1;
				openAbort?.abort();
			} }),
			defineTool({
				id: "view.project.open",
				path: [
					"view",
					"project",
					"open"
				],
				title: "Open View project",
				summary: "Open a project on the running View and return its headed document URL.",
				realm: "host",
				argsSchema: toolJsonSchema(projectOpenSchema),
				resultSchema: toolJsonSchema({ type: "object" }),
				inputSchema: projectOpenSchema,
				outputSchema: { type: "object" },
				evidence: []
			}, (args) => {
				const epoch = sessionEpoch;
				return enqueue(() => openProject(args, epoch));
			})
		];
		const revoke = registerTools(ctx, tools, {
			sourceId: "view-launcher",
			module: "@forgeax/view/plugin",
			realm: "host"
		});
		ctx.effect(() => async () => {
			await revoke();
			await queue;
			await stop();
		});
	}
};
export { product_default as default };
