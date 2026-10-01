export {
  registerBuiltinServer,
  connectToServer,
  disconnectFromServer,
  resolveClient,
  resolveBuiltinServerName,
  connectAutoServers,
  disconnectAll,
  isConnected,
  clear,
} from './connection-lifecycle';

export { testConnection } from './connection-test';

export {
  dispatchBuiltinTool,
  listServerTools,
} from './connection-dispatch';
