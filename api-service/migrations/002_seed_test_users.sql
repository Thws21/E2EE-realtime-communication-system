-- Seed 5 test users. Password for all: Test@1234
-- Hashes use scrypt (N=16384 default, r=8, p=1, keyLen=64, base64url).
-- ON CONFLICT DO NOTHING — safe to re-run; existing users are untouched.
INSERT INTO users (email, username, password_hash, display_name) VALUES
  ('alice@test.local',   'alice',   'scrypt:_Uh-AF86cDgru3Hvt_OJsw:yz2CszvbtGa0il2NOp1FtPgTZmvQ1FZaQj2In3gbRG3spP9A42-c9LQ7UZFswKKoSIwniBF8xe9zTvVgGOsjXQ', 'Alice Nguyen'),
  ('bob@test.local',     'bob',     'scrypt:vlvXR3h1EoKhwI7ftZVNSA:uth_MbKVyZujcqfs5hycCbUqmhtPZcSjTGrbfyOD0zS2g-ccoqTZG-ewHVgZkWrN8Z0-lMBotDibxbpp0MzBdg', 'Bob Tran'),
  ('charlie@test.local', 'charlie', 'scrypt:zAssDNjVgwFuPp8hbkaLKw:VXJPKXBXjE0eLaGwlWylbH01Yqdv9WKgZFJ2oHR7hrNlpRIiuBNt_oQSd3IxQVD6Z7fYkG_V-GjefIQ9PnGUtA', 'Charlie Le'),
  ('diana@test.local',   'diana',   'scrypt:jZw-X2ZDq1NgRW4olk-Jkg:N_rR0KB_x5Ag-GLEQv0B39UXSlbmmMWe13y-ROjIrYsd6sbNrm6inWSFwsBMu1XjPo6qH3P0CXoFkZRB650o9g', 'Diana Pham'),
  ('eve@test.local',     'eve',     'scrypt:kZb61bzEVaf-k9MJ7HUOWw:nnpRL_90Ez4kcdDepbOHuVTTpztbUs9WsZgxrZuL6pIzFiKYk8WOptgfETi_JpMYOzJCriEpMIvM--f3oNd_vg', 'Eve Hoang')
ON CONFLICT (email) DO NOTHING;
