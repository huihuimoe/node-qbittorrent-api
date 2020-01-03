﻿'use strict';

const fs = require('fs');
const path = require('path');
const urlString = require('url');
const queryString = require('querystring');
const async = require('async');
const request = require('request');
const stream = require('stream');

module.exports.connect = startSession;


/**
 * @param {string=} host
 * @param {string=} username
 * @param {string=} password
 * @return {Object}
 */
function startSession(host, username, password) {
  if (!host) {
    host = 'http://localhost:8080';
  } else if (!host.startsWith('http')) {
    host = 'http://' + host;
  }
  if (host.endsWith('/')) {
    host = host.slice(0, -1);
  }
  const baseRequest = request.defaults({jar: true});
  const queue = async.queue(function(req, callback) {
    req.url = host + req.url;
    baseRequest(req, callback);
  });
  const reconnect = logIn.bind(undefined, queue, username, password, function(error) {
    if (error) {
      throw error;
    }
  });
  if (username && password) {
    reconnect();
  }
  const cookies = new Map();
  return {
    reconnect: reconnect,
    all: function(label, options, callback) {
      getTorrentList(queue, 'all', label, options, callback);
    },
    downloading: function(label, options, callback) {
      getTorrentList(queue, 'downloading', label, options, callback);
    },
    seeding: function(label, options, callback) {
      getTorrentList(queue, 'seeding', label, options, callback);
    },
    completed: function(label, options, callback) {
      getTorrentList(queue, 'completed', label, options, callback);
    },
    resumed: function(label, options, callback) {
      getTorrentList(queue, 'resumed', label, options, callback);
    },
    paused: function(label, options, callback) {
      getTorrentList(queue, 'paused', label, options, callback);
    },
    active: function(label, options, callback) {
      getTorrentList(queue, 'active', label, options, callback);
    },
    inactive: function(label, options, callback) {
      getTorrentList(queue, 'inactive', label, options, callback);
    },
    queued: function(label, options, callback) {
      getTorrentList(queue, 'queued', label, options, callback);
    },
    errored: function(label, options, callback) {
      getTorrentList(queue, 'errored', label, options, callback);
    },
    version: function(callback) {
      getGlobalInfo(queue, '/version/qbittorrent', callback);
    },
    api: function(callback) {
      getGlobalInfo(queue, '/version/api', callback);
    },
    apiMin: function(callback) {
      getGlobalInfo(queue, '/version/api_min', callback);
    },
    transferInfo: function(callback) {
      getGlobalInfo(queue, '/query/transferInfo', callback);
    },
    preferences: function(callback) {
      getGlobalInfo(queue, '/query/preferences', callback);
    },
    getGlobalDlLimit: function(callback) {
      getGlobalInfo(queue, '/command/getGlobalDlLimit', callback);
    },
    getGlobalUpLimit: function(callback) {
      getGlobalInfo(queue, '/command/getGlobalUpLimit', callback);
    },
    alternativeSpeedLimitsEnabled: function(callback) {
      getGlobalInfo(queue, '/command/alternativeSpeedLimitsEnabled', callback);
    },
    details: function(torrent, callback) {
      getTorrentDetails(queue, 'propertiesGeneral', torrent, callback);
    },
    trackers: function(torrent, callback) {
      getTorrentDetails(queue, 'propertiesTrackers', torrent, callback);
    },
    webseeds: function(torrent, callback) {
      getTorrentDetails(queue, 'propertiesWebSeeds', torrent, callback);
    },
    files: function(torrent, callback) {
      getTorrentDetails(queue, 'propertiesFiles', torrent, callback);
    },
    pauseAll: function(callback) {
      execGlobalCommand(queue, 'pauseAll', {}, callback);
    },
    resumeAll: function(callback) {
      execGlobalCommand(queue, 'resumeAll', {}, callback);
    },
    setGlobalDlLimit: function(value, callback) {
      execGlobalCommand(queue, 'setGlobalDlLimit', {limit: value}, callback);
    },
    setGlobalUpLimit: function(value, callback) {
      execGlobalCommand(queue, 'setGlobalUpLimit', {limit: value}, callback);
    },
    setPreferences: function(values, callback) {
      execGlobalCommand(queue, 'setPreferences', {
        json: JSON.stringify(values),
      }, callback);
    },
    toggleAlternativeSpeedLimits: function(values, callback) {
      execGlobalCommand(queue, 'toggleAlternativeSpeedLimits', {}, callback);
    },
    add: function(torrent, savePath, label, callback) {
      const options = {};
      if (savePath) {
        if (typeof savePath === 'function') {
          callback = savePath;
        } else {
          options['savepath'] = savePath;
        }
      }
      if (label) {
        if (typeof label === 'function') {
          callback = label;
        } else {
          options['label'] = label;
        }
      }
      if (typeof torrent === 'string' && torrent.match(/^(?:http|magnet:|bc:)/)) {
        options['cookie'] = cookies.get(urlString.parse(torrent).host);
        addTorrentUrl(queue, torrent, options, callback);
      } else {
        addTorrent(queue, torrent, options, callback);
      }
    },
    add2: function(torrent, options, callback) {
      options = options || {};
      if (options) {
        if (typeof options === 'function') {
          callback = options;
          options = {};
        }
      }
      if (typeof torrent === 'string' && torrent.match(/^(?:http|magnet:|bc:)/)) {
        options['cookie'] = cookies.get(urlString.parse(torrent).host);
        addTorrentUrl(queue, torrent, options, callback);
      } else {
        addTorrent(queue, torrent, options, callback);
      }
    },
    addTrackers: function(torrent, trackers, callback) {
      execTorrentCommand(queue, 'addTrackers', torrent, {
        // urls: [].concat(trackers).join("%0A").replace(/&/g, "%26")
        urls: [].concat(trackers).join('\n'),
      }, callback);
    },
    pause: function(torrents, callback) {
      execTorrentCommand(queue, 'pause', torrents, {}, callback);
    },
    resume: function(torrents, callback) {
      execTorrentCommand(queue, 'resume', torrents, {}, callback);
    },
    recheck: function(torrents, callback) {
      execTorrentCommand(queue, 'recheck', torrents, {}, callback);
    },
    setFilePrio: function(torrent, fileId, value, callback) {
      torrent = getHashList(torrent)[0];
      execTorrentCommand(queue, 'setFilePrio', torrent, {
        id: fileId,
        priority: value,
      }, callback);
    },
    delete: function(torrents, callback) {
      execGroupCommand(queue, 'delete', torrents, {}, callback);
    },
    deleteData: function(torrents, callback) {
      execGroupCommand(queue, 'deletePerm', torrents, {}, callback);
    },
    increasePrio: function(torrents, callback) {
      execGroupCommand(queue, 'increasePrio', torrents, {}, callback);
    },
    decreasePrio: function(torrents, callback) {
      execGroupCommand(queue, 'decreasePrio', torrents, {}, callback);
    },
    topPrio: function(torrents, callback) {
      execGroupCommand(queue, 'topPrio', torrents, {}, callback);
    },
    bottomPrio: function(torrents, callback) {
      execGroupCommand(queue, 'bottomPrio', torrents, {}, callback);
    },
    setDlLimit: function(torrents, value, callback) {
      execGroupCommand(queue, 'setTorrentsDlLimit', torrents, {limit: value}, callback);
    },
    setUpLimit: function(torrents, value, callback) {
      execGroupCommand(queue, 'setTorrentsUpLimit', torrents, {limit: value}, callback);
    },
    setLabel: function(torrents, value, callback) {
      execGroupCommand(queue, 'setLabel', torrents, {label: value}, callback);
    },
    toggleSeqDl: function(torrents, callback) {
      execGroupCommand(queue, 'toggleSequentialDownload', torrents, {}, callback);
    },
    toggleFirstLastPiecePrio: function(torrents, callback) {
      execGroupCommand(queue, 'toggleFirstLastPiecePrio', torrents, {}, callback);
    },
    setForceStart: function(torrents, value, callback) {
      execGroupCommand(queue, 'setForceStart', torrents, {value: value}, callback);
    },
    getDlLimit: function(torrent, callback) {
      torrent = getHashList(torrent)[0];
      execGroupCommand(queue, 'getTorrentsDlLimit', torrent, {}, callback);
    },
    getUpLimit: function(torrent, callback) {
      torrent = getHashList(torrent)[0];
      execGroupCommand(queue, 'getTorrentsUpLimit', torrent, {}, callback);
    },
    search: function(searchText, options, callback) {
      searchTorrents(queue, searchText, options, callback);
    },
    setCookie: function(host, value) {
      cookies.set(host, value);
    },
  };
}


/**
 * @param {Queue} queue
 * @param {string} username
 * @param {string} password
 * @param {function(error:Error)} callback
 */
function logIn(queue, username, password, callback) {
  if (!username || !password) {
    callback(new Error('Must provide username and password.'));
    return;
  }
  queue.push({
    method: 'POST',
    url: '/login',
    formData: {
      'username': username,
      'password': password,
    },
  }, function(error, response) {
    if (error) {
      callback(error);
      return;
    }
    if (response.statusCode !== 200) {
      callback(new Error('Login failed ' + response.statusCode + '  with username: ' + username));
      return;
    }
    callback();
  });
}


/**
 * @param {Queue} queue
 * @param {(string|Readable)} torrent
 * @param {Object} options
 * @param {function(error:Error)=} callback
 */
function addTorrent(queue, torrent, options, callback) {
  if (torrent instanceof stream.Readable) {
    options['torrents'] = {
      value: torrent,
      options: {
        filename: torrent.path,
        contentType: 'application/x-bittorrent',
      },
    };
  } else if (typeof torrent === 'string') {
    try {
      options['torrents'] = {
        value: fs.createReadStream(torrent),
        options: {
          filename: path.basename(torrent),
          contentType: 'application/x-bittorrent',
        },
      };
    } catch (error) {
      if (callback) {
        callback(error);
      }
      return;
    }
  } else {
    if (callback) {
      callback(new Error('Torrent must be path or readable stream.'));
    }
    return;
  }
  queue.push({
    method: 'POST',
    url: '/command/upload',
    formData: options,
  }, function(error, response) {
    if (callback) {
      if (error) {
        callback(error);
        return;
      }
      if (response && response.statusCode !== 200) {
        callback(new Error('AddTorrent failed ' + response.statusCode + '  with options: ' + JSON.stringify(options)));
        return;
      }
      callback();
    }
  });
}


/**
 * @param {Queue} queue
 * @param {string} url
 * @param {Object} options
 * @param {function(error:Error)=} callback
 */
function addTorrentUrl(queue, url, options, callback) {
  options['urls'] = [].concat(url).join('\n');
  queue.push({
    method: 'POST',
    url: '/command/download',
    formData: options,
  }, function(error, response) {
    if (callback) {
      if (error) {
        callback(error);
        return;
      }
      if (response && response.statusCode !== 200) {
        callback(new Error('AddTorrentUrl failed ' + response.statusCode + '  with options: ' + JSON.stringify(options)));
        return;
      }
      callback();
    }
  });
}


/**
 * @typedef {Object} ListOptions
 * @property {string} sort
 * @property {bool} reverse
 * @property {number} limit
 * @property {number} offset
 */

/**
 * @param {Queue} queue
 * @param {string} filter
 * @param {string=} label
 * @param {ListOptions=} options
 * @param {function(error:Error,items:Array<Object>)} callback
 */
function getTorrentList(queue, filter, label, options, callback) {
  if (typeof label !== 'string') {
    callback = options;
    options = label;
    label = null;
  }
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  switch (filter) {
    case 'seeding':
      options['filter'] = 'completed';
      break;
    case 'resumed':
      options['filter'] = 'all';
      break;
    case 'errored':
    case 'queued':
      options['filter'] = 'inactive';
      break;
    default:
      options['filter'] = filter;
  }
  if (label) {
    options['label'] = label;
  }
  queue.push({
    method: 'GET',
    url: '/query/torrents?' + queryString.stringify(options),
  }, function(error, response, body) {
    if (error) {
      callback(error);
      return;
    }
    if (response.statusCode !== 200) {
      callback(new Error('GetTorrentList failed ' + response.statusCode + '  with options: ' + JSON.stringify(options)));
      return;
    }
    let items = JSON.parse(body);
    switch (filter) {
      case 'seeding':
        items = items.filter(function(item) {
          return item.state === 'stalledUP' || item.state === 'uploading';
        });
        break;
      case 'resumed':
        items = items.filter(function(item) {
          return !item.state.startsWith('paused');
        });
        break;
      case 'queued':
        items = items.filter(function(item) {
          return item.state.startsWith('queued');
        });
        break;
      case 'errored':
        items = items.filter(function(item) {
          return item.state === 'error' || item.state === 'missingFiles';
        });
        break;
      default:
    }
    callback(null, items);
  });
}


/**
 * @param {Queue} queue
 * @param {(string|RegExp)} searchText
 * @param {Object=} options
 * @param {function(error:Error,items:Array<Object>)} callback
 */
function searchTorrents(queue, searchText, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (!options.filter) {
    options.filter = 'all';
  }
  getTorrentList(queue, options.filter, options, function(error, items) {
    if (typeof searchText === 'string') {
      items = items.filter(function(item) {
        return item.name.indexOf(searchText) !== -1;
      });
    } else if (searchText.test) {
      items = items.filter(function(item) {
        return searchText.test(item.name);
      });
    }
    callback(error, items);
  });
}


/**
 * @param {Queue} queue
 * @param {string} query
 * @param {function(error:Error,data:Object)} callback
 */
function getGlobalInfo(queue, query, callback) {
  queue.push({
    method: query.startsWith('/command/') ? 'POST' : 'GET',
    url: query,
  }, function(error, response, body) {
    if (error) {
      try {
        callback(error, JSON.parse(body));
      } catch (e) {
        callback(error, body);
      }
      return;
    }
    if (response.statusCode !== 200) {
      callback(new Error('GetGlobalInfo failed ' + response.statusCode + ' '));
      return;
    }
    callback();
  });
}


/**
 * @param {Queue} queue
 * @param {string} query
 * @param {(TorrentDetails|string)} torrents
 * @param {function(error:Error,data:Object)} callback
 */
function getTorrentDetails(queue, query, torrents, callback) {
  const hash = getHashList(torrents)[0];
  queue.push({
    method: 'GET',
    url: '/query/' + query + '/' + hash,
  }, function(error, response, body) {
    if (callback) {
      if (error) {
        try {
          callback(error, JSON.parse(body));
        } catch (e) {
          callback(error, body);
        }
        return;
      }
      if (response.statusCode !== 200) {
        callback(new Error('GetTorrentDetails failed ' + response.statusCode + '  with hash: ' + hash));
        return;
      }
      callback();
    }
  });
}


/**
 * @param {Queue} queue
 * @param {string} command
 * @param {Object=} options
 * @param {function(error:Error,data:Object)=} callback
 */
function execGlobalCommand(queue, command, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  queue.push({
    method: 'POST',
    url: '/command/' + command,
    formData: options,
  }, function(error, response, body) {
    if (callback) {
      if (error) {
        try {
          callback(error, JSON.parse(body));
        } catch (e) {
          callback(error, body);
        }
        return;
      }
      if (response.statusCode !== 200) {
        callback(new Error('ExecGlobalCommand failed ' + response.statusCode + '  with options: ' + JSON.stringify(options)));
        return;
      }
      callback();
    }
  });
}


/**
 * @param {Queue} queue
 * @param {string} command
 * @param {(TorrentDetails|string|Array<(TorrentDetails|string)>)} torrents
 * @param {Object=} options
 * @param {function(error:Error,data:Array<Object>)=} callback
 */
function execTorrentCommand(queue, command, torrents, options, callback) {
  async.map(getHashList(torrents), function(hash, done) {
    queue.push({
      method: 'POST',
      url: '/command/' + command,
      formData: Object.assign({}, options, {hash: hash}),
    }, function(error, response, body) {
      if (error) {
        done(error);
        return;
      }
      if (response.statusCode !== 200) {
        done(new Error('ExecTorrentCommand failed ' + response.statusCode + '  with options: ' + JSON.stringify(Object.assign({}, options, {hash: hash}))));
        return;
      }
      try {
        done(null, JSON.parse(body));
      } catch (e) {
        done(null, body);
      }
    });
  }, function(error, results) {
    if (callback) {
      callback(error, results);
    }
  });
}


/**
 * @param {Queue} queue
 * @param {string} command
 * @param {(TorrentDetails|string|Array<(TorrentDetails|string)>)} torrents
 * @param {Object=} options
 * @param {function(error:Error,data:Object)=} callback
 */
function execGroupCommand(queue, command, torrents, options, callback) {
  queue.push({
    method: 'POST',
    url: '/command/' + command,
    formData: Object.assign({}, options, {hashes: getHashList(torrents).join('|')}),
  }, function(error, response, body) {
    if (callback) {
      if (error) {
        callback(error);
        return;
      }
      if (response.statusCode !== 200) {
        callback(new Error('ExecGroupCommand failed ' + response.statusCode + '  with options: ' + JSON.stringify(options)));
        return;
      }
      try {
        callback(null, JSON.parse(body));
      } catch (e) {
        callback(null, body);
      }
    }
  });
}


/**
 * @param {(TorrentDetails|string|Array<(TorrentDetails|string)>)} items
 * @return {Array<string>}
 */
function getHashList(items) {
  const hashes = [];
  [].concat(items).forEach(function(item) {
    if (typeof item === 'string') {
      hashes.push(item);
    } else if (item.hash) {
      hashes.push(item.hash);
    }
  });
  return hashes;
}
