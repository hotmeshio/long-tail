export {
  registerBuiltinServer,
  getBuiltinToolManifest,
  connectToServer,
  disconnectFromServer,
  listServerTools,
  registeredBuiltinToolNames,
  resolveClient,
  resolveBuiltinServerName,
  connectAutoServers,
  disconnectAll,
  isConnected,
  clear,
} from './connection';

export {
  callServerTool,
  callBuiltinToolAs,
  toolActivities,
} from './tools';
