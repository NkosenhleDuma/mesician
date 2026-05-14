import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const songs = pgTable("songs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 512 }).notNull(),
  artist: varchar("artist", { length: 512 }),
  difficulty: integer("difficulty").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const songUploads = pgTable("song_uploads", {
  id: uuid("id").defaultRandom().primaryKey(),
  songId: uuid("song_id")
    .notNull()
    .references(() => songs.id, { onDelete: "cascade" }),
  filename: varchar("filename", { length: 1024 }).notNull(),
  gpFormat: varchar("gp_format", { length: 8 }).notNull(), // gp | gp3 | gp4 | gp5 | gpx
  minioObjectKey: text("minio_object_key").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
});

export const songTracks = pgTable("song_tracks", {
  id: uuid("id").defaultRandom().primaryKey(),
  songId: uuid("song_id")
    .notNull()
    .references(() => songs.id, { onDelete: "cascade" }),
  trackIndex: integer("track_index").notNull(),
  name: varchar("name", { length: 512 }).notNull(),
  instrument: varchar("instrument", { length: 256 }),
  tuningJson: jsonb("tuning_json").$type<string[]>(),
  isGuitar: boolean("is_guitar").notNull().default(true),
  /** Canonical chart (full fidelity) used for practice and classification */
  sourceChartObjectKey: text("source_chart_object_key"),
  /** Optional full user-authored override in MinIO (merged for practice when present) */
  userChartObjectKey: text("user_chart_object_key"),
  /** False when the source chart has no note/chord events (rests-only / empty) */
  hasNotes: boolean("has_notes").notNull().default(true),
  difficulty: integer("difficulty").notNull(),
});

export const practiceSessions = pgTable("practice_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  trackId: uuid("track_id")
    .notNull()
    .references(() => songTracks.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  scoreJson: jsonb("score_json"),
});
