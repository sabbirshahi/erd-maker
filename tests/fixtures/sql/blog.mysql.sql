-- MySQL dump 10.13  Distrib 8.0.36, for Linux (x86_64)
-- Equivalent to tests/fixtures/blog.dbml after normalizeForSql (posts <> tags becomes posts_tags).

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET NAMES utf8mb4 */;
SET FOREIGN_KEY_CHECKS = 0;
USE `blog`;

DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(150) NOT NULL,
  `email` varchar(254) NOT NULL,
  `is_active` boolean NOT NULL DEFAULT true,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Registered users';

CREATE TABLE `posts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `author_id` int NOT NULL,
  `title` varchar(200) NOT NULL,
  `body` text,
  `status` ENUM ('draft', 'published', 'archived') NOT NULL DEFAULT 'draft',
  `published_at` timestamp NULL,
  PRIMARY KEY (`id`),
  KEY `posts_index_0` (`author_id`, `published_at`),
  CONSTRAINT `posts_ibfk_1` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB;

CREATE TABLE `tags` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB;

CREATE TABLE `comments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `post_id` int NOT NULL,
  `user_id` int NOT NULL,
  `body` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE `posts_tags` (
  `posts_id` int NOT NULL,
  `tags_id` int NOT NULL,
  PRIMARY KEY (`posts_id`, `tags_id`)
) ENGINE=InnoDB;

ALTER TABLE `comments` ADD FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`) ON DELETE CASCADE;
ALTER TABLE `comments` ADD FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
ALTER TABLE `posts_tags` ADD FOREIGN KEY (`posts_id`) REFERENCES `posts` (`id`);
ALTER TABLE `posts_tags` ADD FOREIGN KEY (`tags_id`) REFERENCES `tags` (`id`);

LOCK TABLES `users` WRITE;
INSERT INTO `users` VALUES (1,'admin','admin@example.com',1,'2024-01-01 00:00:00');
UNLOCK TABLES;
SET FOREIGN_KEY_CHECKS = 1;
