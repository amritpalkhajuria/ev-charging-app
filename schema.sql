CREATE TABLE IF NOT EXISTS charging_stations (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  ocm_id         INT NOT NULL,              -- OpenChargeMap station ID, the natural key
  station_name   VARCHAR(255) NOT NULL,
  latitude       DECIMAL(10, 7) NOT NULL,
  longitude      DECIMAL(10, 7) NOT NULL,
  address        VARCHAR(255),              -- NULL when the source has no address line
  town           VARCHAR(100),
  postcode       VARCHAR(20),
  operator       VARCHAR(255),
  connector_type VARCHAR(255),              -- distinct connector names, comma separated
  power_kw       DECIMAL(6, 1),             -- fastest connector at the station
  num_connectors INT,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ocm_id (ocm_id),
  KEY idx_location (latitude, longitude)
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id INT AUTO_INCREMENT PRIMARY KEY,
  station_id INT NOT NULL,
  user_id    INT NOT NULL,
  start_time DATETIME NOT NULL,
  end_time   DATETIME,
  status     VARCHAR(20) NOT NULL,
  total_cost DECIMAL(10, 2),
  FOREIGN KEY (station_id) REFERENCES charging_stations(id)
);
