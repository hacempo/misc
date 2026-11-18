const Database = require('better-sqlite3');

function openVideoDatabase(file) {
    const db = new Database(file);
    db.exec('CREATE TABLE IF NOT EXISTS videos (id INTEGER PRIMARY KEY)');

    const has = db.prepare('SELECT 1 FROM videos WHERE id = ?');
    const insert = db.prepare('INSERT OR IGNORE INTO videos (id) VALUES (?)');

    return {
        has: id => Boolean(has.get(id)),
        insert: id => insert.run(id).changes === 1,
        insertMany(ids) {
            return db.transaction(values => values.reduce(
                (count, id) => count + insert.run(id).changes, 0
            ))(ids);
        },
        count: () => db.prepare('SELECT COUNT(*) AS count FROM videos').get().count,
        close: () => db.close()
    };
}

module.exports = { openVideoDatabase };
