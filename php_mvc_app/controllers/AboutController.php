<?php
class AboutController {
    public function index() {
        $data = [
            'title' => 'About Us',
            'description' => 'This is a modular PHP MVC framework built for scalability and maintainability.'
        ];
        $this->render('about', $data);
    }

    private function render($view, $data = []) {
        extract($data);
        require VIEWS_PATH . '/' . $view . '.php';
    }
}
