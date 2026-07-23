export const state = {
  db: null,
  runs: [],
  modelNames: [],
  modelStats: {},
  charts: {},
  currentTab: 'overview',
  explorerModel: 'qwen/qwen3-coder-480b-a35b-instruct',
  lbSort: { col: 'score', dir: 'desc' },
  lbFilter: '',
  lbData: null,
  timelineFilter: 'all',
  modalResponse: '',
  timeslotModels: []
};
