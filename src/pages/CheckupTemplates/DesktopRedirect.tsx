import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function DesktopRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/h/checkup-templates', { replace: true });
  }, [navigate]);
  return null;
}
