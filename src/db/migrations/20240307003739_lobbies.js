const knex = require('knex')

/**
 * Creates the Lobby table
 *
 * @param { import("knex").Knex } knex
 * @returns {Knex.SchemaBuilder}
 */
exports.up = function (knex) {
    return knex.schema.createTable('users', function (table) {
        // TODO brocodedude define your user table schema here
            table.increments('id').primary();
        }
    ).createTable('lobbies', function (table) {
        table.increments('id').primary();
        table.integer('uid').unsigned();
        table.foreign('uid').references('id').inTable('users');
        table.string('lobby_name').unique().notNullable();
        table.string('lobby_id').unique().notNullable();
        table.timestamps(true, true);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns {Knex.SchemaBuilder}
 */
exports.down = function (knex) {
    return knex.schema.dropTable('lobbies').dropTable('users');
};
