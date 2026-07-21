<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= $title ?></title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; }
        p { color: #666; line-height: 1.6; }
        nav { margin-bottom: 20px; }
        nav a { margin-right: 15px; text-decoration: none; color: #007bff; }
        nav a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="container">
        <nav>
            <a href="/">Home</a>
            <a href="/about">About</a>
            <a href="/contact">Contact</a>
        </nav>
        <h1><?= $title ?></h1>
        <p><?= $message ?></p>
    </div>
</body>
</html>