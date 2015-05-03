
var fs = require('mz/fs'),
    co = require('co'),
    superagent = require('superagent'),
    yaml = require('js-yaml')

// superagent middleware
function withPromise() {
  return function (req) {
    req.end = function () {
      return new Promise(function (resolve, reject) {
        Object.getPrototypeOf(req).end.call(req, function (err, res) {
          if (err) { reject(err) }
          if (!res.ok) { reject(res.text) }
          resolve(res)
        })
      })
    }
  }
}

var topicURL = 'http://community.citizenedu.tw/t/topic'
var postsPath = __dirname + '/../src/posts'
var columnsPath = __dirname + '/../src/columns'

function getFileMeta(fn) {
  var meta = fs.readFileSync(fn, 'utf-8').split('---')[1]
  return yaml.safeLoad(meta)
}

function buildIndex(path) {
  return function (files) {
    var index = {}
    files.forEach(function (fn) {
      index[fn] = getFileMeta(`${path}/${fn}`)
    })
    return index
  }
}

function* readFiles(path) {
  return fs.readdir(path)
    .then(buildIndex(path))
    .catch(function (err) { console.error(err) })
}

co(function* () {
  var [posts, columns] = yield [postsPath, columnsPath].map(readFiles)

  yield Object.keys(columns)
    .filter((n) => (undefined !== columns[n].link && columns[n].link))
    .map(function (name) {
      return superagent
        .get(`${columns[name].link}.json`)
        .use(withPromise())
        .end()
        .then((res) => Object.assign(columns[name], res.body))
        .catch(function (err) { console.error(err) })
    })
  // console.log(columns)

  yield Object.values(columns)
    .filter((c) => undefined !== c.topic_list && c.topic_list.topics)
    .map(function (column) {
      return column.topic_list.topics
        .filter((t) => !t.pinned)
        .filter((t) => !posts[`${t.id}.html`])
        .map((t) => Object.assign(t, { column_title: column.title }))
    })
    .reduce((prev, cur) => prev.concat(cur))
    .map(function (topicInfo) {
      return superagent
        .get(`${topicURL}/${topicInfo.id}.json`)
        .use(withPromise())
        .end()
        .catch(function (err) { console.error(err) })
        .then((res) => res.body)
        // alright, we are using Discourse topic ID as Blog post ID...
        .then(function (topic) {
          return fs.writeFile(`${postsPath}/${topic.id}.html`,
`---
title: ${topic.title}
created_at: ${topic.created_at.replace(/T.*/, '')}
modified_at: ${topic.post_stream.posts[0].updated_at.replace(/T.*/, '')}
author: ${topic.post_stream.posts[0].name}
rtemplate: ArticlePage
collection: ['${topicInfo.column_title}', '哲學', 'posts']
---
${topic.post_stream.posts[0].cooked}
`)
        })
    })
})
