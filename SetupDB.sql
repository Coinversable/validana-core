/*
 * This script forms the basis for setting up the processor and node, but should not be used stand alone.
 */

/* Create schema for all non-smart contract data, all smart contract data is in the public schema. */
CREATE SCHEMA IF NOT EXISTS basics;

CREATE TABLE IF NOT EXISTS basics.contracts (
	/* The hash of the contract code. */
	contract_hash BYTEA PRIMARY KEY NOT NULL CHECK (octet_length(contract_hash) = 32),
	/* The contract type/name. */
	contract_type VARCHAR(64) NOT NULL,
	/* The version of the contract, to help the user. */
	contract_version VARCHAR(32) NOT NULL,
	/* A short description of the contract, to help the user. */
	description VARCHAR(256) NOT NULL,
	/* Address of who created the contract. */
	creator VARCHAR(35) NOT NULL,
	/* The template that the payload should have. */
	contract_template JSON NOT NULL,
	/* The actual contract code. */
	code BYTEA NOT NULL,
	/* The version of validana this smart contract was created for. To support backwards compatibility. */
	validana_version SMALLINT NOT NULL DEFAULT 1
);

/* Add the smartcontract and smartcontractmanager roles. The node/processor user should have these roles. */
DO $$ BEGIN
	/* Smart contract can do everything in the public schema. */
	IF NOT EXISTS (SELECT * FROM pg_catalog.pg_roles WHERE rolname = 'smartcontract') THEN
		CREATE ROLE smartcontract;
	END IF;
	/* Smart contract manager can create/delete smart contracts. */
	IF NOT EXISTS (SELECT * FROM pg_catalog.pg_roles WHERE rolname = 'smartcontractmanager') THEN
		CREATE ROLE smartcontractmanager;
	END IF;
END $$;

/* Give needed user rights to smartcontract and smartcontractmanager. */
GRANT ALL PRIVILEGES ON SCHEMA public TO smartcontract;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO smartcontract;
GRANT SELECT (datname, encoding) ON TABLE pg_catalog.pg_database TO smartcontract;
GRANT SELECT (indexrelid, indkey) ON TABLE pg_catalog.pg_index TO smartcontract;
GRANT SELECT ON TABLE information_schema.tables, information_schema.columns, information_schema.element_types,
	information_schema.key_column_usage, information_schema.referential_constraints, information_schema.table_constraints,
	information_schema.constraint_column_usage, information_schema.constraint_table_usage, information_schema.check_constraints TO smartcontract;
GRANT USAGE ON SCHEMA basics TO smartcontractmanager;
GRANT SELECT, INSERT, DELETE ON TABLE basics.contracts TO smartcontractmanager;

/*
 * Revoke everything they should not have access to (including the common non-deterministic functions).
 * If you need this for other users in your database you can skip this, however make sure not to use them in smart contracts!
 */
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA pg_catalog, information_schema FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION setseed, random, nextval, currval, lastval, now, statement_timestamp, timeofday, transaction_timestamp,
	clock_timestamp, to_timestamp(text, text), to_timestamp(double precision), age(timestamp, timestamp),
	pg_xact_commit_timestamp, pg_last_committed_xact, inet_client_addr, inet_client_port, inet_server_addr,
	inet_server_port, version, set_config, current_setting(text), current_setting(text, boolean), 
	txid_snapshot_in, txid_snapshot_out, txid_snapshot_recv, txid_snapshot_send, txid_current, txid_current_snapshot,
	txid_snapshot_xmin, txid_snapshot_xmax, txid_snapshot_xip, txid_status FROM PUBLIC;