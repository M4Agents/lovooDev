<?php
// Pixel tracking endpoint
header('Content-Type: image/gif');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');

// Get parameters
$action = $_GET['action'] ?? '';
$tracking_code = $_GET['tracking_code'] ?? '';
$visitor_id = $_GET['visitor_id'] ?? '';

// Log the tracking data (you would normally save to database here)
error_log("Tracking: $action - $tracking_code - $visitor_id");

// Return 1x1 transparent GIF
$gif = base64_decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
echo $gif;
exit;
?>
