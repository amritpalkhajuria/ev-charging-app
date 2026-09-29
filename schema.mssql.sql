-- Azure SQL Database / SQL Server version of schema.sql.
-- Batches are separated by GO, as in sqlcmd and the Azure portal query editor.

IF OBJECT_ID('dbo.charging_stations') IS NULL
CREATE TABLE dbo.charging_stations (
  id             INT IDENTITY(1, 1) PRIMARY KEY,
  ocm_id         INT NOT NULL CONSTRAINT uq_ocm_id UNIQUE,  -- OpenChargeMap station ID, the natural key
  station_name   NVARCHAR(255) NOT NULL,
  latitude       DECIMAL(10, 7) NOT NULL,
  longitude      DECIMAL(10, 7) NOT NULL,
  address        NVARCHAR(255),              -- NULL when the source has no address line
  town           NVARCHAR(100),
  postcode       NVARCHAR(20),
  operator       NVARCHAR(255),
  connector_type NVARCHAR(255),              -- distinct connector names, comma separated
  power_kw       DECIMAL(6, 1),              -- fastest connector at the station
  num_connectors INT,
  updated_at     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_location')
CREATE INDEX idx_location ON dbo.charging_stations (latitude, longitude);
GO

IF OBJECT_ID('dbo.sessions') IS NULL
CREATE TABLE dbo.sessions (
  session_id INT IDENTITY(1, 1) PRIMARY KEY,
  station_id INT NOT NULL REFERENCES dbo.charging_stations (id),
  user_id    INT NOT NULL,
  start_time DATETIME2 NOT NULL,
  end_time   DATETIME2,
  status     NVARCHAR(20) NOT NULL,
  total_cost DECIMAL(10, 2)
);
GO
