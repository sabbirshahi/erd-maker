--
-- PostgreSQL database dump (pg_dump 16 style) equivalent to tests/fixtures/blog.dbml after
-- normalizeForSql (posts <> tags becomes posts_tags). Sequences, OWNER, GRANT and psql
-- meta-commands are noise the importer must survive.
--

\restrict abc123
SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
\connect blog

CREATE SCHEMA public;
ALTER SCHEMA public OWNER TO blog;
COMMENT ON SCHEMA public IS 'standard public schema';

CREATE TYPE public.post_status AS ENUM (
    'draft',
    'published',
    'archived'
);
ALTER TYPE public.post_status OWNER TO blog;

SET default_tablespace = '';
SET default_table_access_method = heap;

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(150) NOT NULL,
    email character varying(254) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.users OWNER TO blog;
COMMENT ON TABLE public.users IS 'Registered users';

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.users_id_seq OWNER TO blog;
ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

CREATE TABLE public.posts (
    id integer NOT NULL,
    author_id integer NOT NULL,
    title character varying(200) NOT NULL,
    body text,
    status public.post_status DEFAULT 'draft'::public.post_status NOT NULL,
    published_at timestamp without time zone
);
ALTER TABLE public.posts OWNER TO blog;

CREATE SEQUENCE public.posts_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.posts_id_seq OWNED BY public.posts.id;

CREATE TABLE public.tags (
    id integer NOT NULL,
    name character varying(50) NOT NULL
);
CREATE SEQUENCE public.tags_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.tags_id_seq OWNED BY public.tags.id;

CREATE TABLE public.comments (
    id integer NOT NULL,
    post_id integer NOT NULL,
    user_id integer NOT NULL,
    body text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.comments_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.comments_id_seq OWNED BY public.comments.id;

CREATE TABLE public.posts_tags (
    posts_id integer NOT NULL,
    tags_id integer NOT NULL
);

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);
ALTER TABLE ONLY public.posts ALTER COLUMN id SET DEFAULT nextval('public.posts_id_seq'::regclass);
ALTER TABLE ONLY public.tags ALTER COLUMN id SET DEFAULT nextval('public.tags_id_seq'::regclass);
ALTER TABLE ONLY public.comments ALTER COLUMN id SET DEFAULT nextval('public.comments_id_seq'::regclass);

ALTER TABLE ONLY public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.users ADD CONSTRAINT users_username_key UNIQUE (username);
ALTER TABLE ONLY public.users ADD CONSTRAINT users_email_key UNIQUE (email);
ALTER TABLE ONLY public.posts ADD CONSTRAINT posts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tags ADD CONSTRAINT tags_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tags ADD CONSTRAINT tags_name_key UNIQUE (name);
ALTER TABLE ONLY public.comments ADD CONSTRAINT comments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.posts_tags ADD CONSTRAINT posts_tags_pkey PRIMARY KEY (posts_id, tags_id);

CREATE INDEX posts_author_id_published_at_idx ON public.posts USING btree (author_id, published_at);

ALTER TABLE ONLY public.posts ADD CONSTRAINT posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);
ALTER TABLE ONLY public.comments ADD CONSTRAINT comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.comments ADD CONSTRAINT comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);
ALTER TABLE ONLY public.posts_tags ADD CONSTRAINT posts_tags_posts_id_fkey FOREIGN KEY (posts_id) REFERENCES public.posts(id);
ALTER TABLE ONLY public.posts_tags ADD CONSTRAINT posts_tags_tags_id_fkey FOREIGN KEY (tags_id) REFERENCES public.tags(id);

GRANT ALL ON SCHEMA public TO blog;
REVOKE USAGE ON SCHEMA public FROM PUBLIC;
\unrestrict abc123
--
-- PostgreSQL database dump complete
--
