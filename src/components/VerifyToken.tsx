import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { verifyToken, setToken } from "../lib/auth";

export function VerifyToken() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setError("Missing token");
      return;
    }

    verifyToken(token)
      .then((jwt) => {
        setToken(jwt);
        navigate("/", { replace: true });
      })
      .catch((err) => setError(String(err)));
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen bg-surface-primary text-text-primary flex items-center justify-center">
      <div className="text-center">
        {error ? (
          <div>
            <p className="text-red-400 mb-2">{error}</p>
            <a href="/login" className="text-blue-400 hover:underline">
              Back to login
            </a>
          </div>
        ) : (
          <p className="text-text-tertiary">Verifying...</p>
        )}
      </div>
    </div>
  );
}
