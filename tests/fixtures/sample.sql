-- Synthetic data for the dataguard tests. Every row is made up.
CREATE TABLE projects (
  id INTEGER PRIMARY KEY, name TEXT, client TEXT, type TEXT, budget NUMERIC, spent NUMERIC,
  stage TEXT, start_date DATE, delivery_date DATE, completed_date DATE
);
CREATE TABLE project_tasks (id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT);
CREATE TABLE project_milestones (id INTEGER PRIMARY KEY, project_id INTEGER, name TEXT, actual_spent NUMERIC);
CREATE TABLE payment_milestones (
  id INTEGER PRIMARY KEY, project_id INTEGER, amount NUMERIC, status TEXT, invoiced_date DATE, paid_date DATE
);
CREATE TABLE project_revisions (id INTEGER PRIMARY KEY, project_id INTEGER, submitted_date DATE, feedback_date DATE);
CREATE TABLE invoices (id INTEGER PRIMARY KEY, project_id INTEGER, invoice_number TEXT, total_amount NUMERIC, status TEXT);
CREATE TABLE contacts (id INTEGER PRIMARY KEY, name TEXT, email TEXT, company TEXT);
CREATE TABLE leads (id INTEGER PRIMARY KEY, name TEXT, email TEXT, company TEXT, stage TEXT);
CREATE TABLE deals (id INTEGER PRIMARY KEY, title TEXT, value NUMERIC, stage TEXT);

INSERT INTO projects VALUES
 (1, 'Garden shed', 'Example Client A', 'build', 1000, 600, 'Delivered', '2026-01-05', '2026-02-01', '2026-02-02'),
 (2, 'Bike rack',   'Example Client B', 'build',  500, 500, 'Active',    '2026-03-10', '2026-03-01', NULL),
 (3, 'Bird feeder', 'Example Client C', 'build',  300, 250, 'Invoiced',  '2026-02-01', '2026-02-20', NULL);
INSERT INTO project_tasks VALUES (1, 1, 'Cut boards'), (2, 2, 'Weld frame'), (3, 999, 'Orphan task');
INSERT INTO project_milestones VALUES (1, 1, 'Frame', 400), (2, 1, 'Roof', 200), (3, 2, 'Frame', 450), (4, 3, 'Box', 250);
INSERT INTO payment_milestones VALUES
 (1, 1, 1000, 'paid',    '2026-02-03', '2026-02-03'),
 (2, 2,  500, 'pending', NULL, NULL),
 (3, 3,  300, 'paid',    '2026-02-25', '2026-02-21');
INSERT INTO project_revisions VALUES (1, 1, '2026-01-10', '2026-01-12');
INSERT INTO invoices VALUES (1, 1, 'INV-001', 1000, 'paid'), (2, 3, 'INV-002', 300, 'sent');
INSERT INTO contacts VALUES (1, 'Sample Person', 'person@example.com', 'Example Co'), (2, 'Other Person', NULL, 'Example Co');
INSERT INTO leads VALUES (1, 'Lead One', 'lead@example.com', 'Example Co', 'new');
INSERT INTO deals VALUES (1, 'Deal One', 100, 'open');

CREATE TABLE bulk_events (id INTEGER PRIMARY KEY, started DATE, ended DATE);
INSERT INTO bulk_events VALUES
 (1, '2026-04-01', '2026-03-01'),
 (2, '2026-04-02', '2026-03-02'),
 (3, '2026-04-03', '2026-03-03'),
 (4, '2026-04-04', '2026-03-04'),
 (5, '2026-04-05', '2026-03-05'),
 (6, '2026-04-06', '2026-03-06'),
 (7, '2026-04-07', '2026-03-07'),
 (8, '2026-04-08', '2026-03-08'),
 (9, '2026-04-09', '2026-03-09'),
 (10, '2026-04-10', '2026-03-10'),
 (11, '2026-04-11', '2026-03-11'),
 (12, '2026-04-12', '2026-03-12');

CREATE TABLE bulk_parents (id INTEGER PRIMARY KEY, total NUMERIC);
INSERT INTO bulk_parents VALUES
 (1, 10),
 (2, 10),
 (3, 10),
 (4, 10),
 (5, 10),
 (6, 10),
 (7, 10),
 (8, 10),
 (9, 10),
 (10, 10),
 (11, 10),
 (12, 10);

CREATE TABLE bulk_children (id INTEGER PRIMARY KEY, parent_id INTEGER, amount NUMERIC);
INSERT INTO bulk_children VALUES
 (1, 1, 5),
 (2, 2, 5),
 (3, 3, 5),
 (4, 4, 5),
 (5, 5, 5),
 (6, 6, 5),
 (7, 7, 5),
 (8, 8, 5),
 (9, 9, 5),
 (10, 10, 5),
 (11, 11, 5),
 (12, 12, 5);
