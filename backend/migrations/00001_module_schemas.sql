-- Module schemas (ARCHITECTURE_MVP_v2 §7.1). Each module writes only to its own schema.
-- Tables, constraints and lock order arrive with the slices that own them.

-- +goose Up
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS access;
CREATE SCHEMA IF NOT EXISTS intake;
CREATE SCHEMA IF NOT EXISTS places;
CREATE SCHEMA IF NOT EXISTS orders;
CREATE SCHEMA IF NOT EXISTS generation;
CREATE SCHEMA IF NOT EXISTS artifacts;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS ops;
