/**
 * Created by andreas on 26.04.16.
 */
avnav.provide('avnav.gui.WpInfoPage');




/**
 *
 * @constructor
 */
avnav.gui.WpInfoPage=function(){
    avnav.gui.Page.call(this,'wpinfopage',
        {
            eventlist:[avnav.nav.NavEvent.EVENT_TYPE],
            returnOnClick: true
        }
    );
    /**
     * private
     * @type {string}
     */
    this.statusItem='.avn_Status';

};
avnav.inherits(avnav.gui.WpInfoPage,avnav.gui.Page);

avnav.gui.WpInfoPage.prototype.localInit=function(){
};
avnav.gui.WpInfoPage.prototype.showPage=function(options) {
    if (!this.gui) return;
    this.fillData(true);
    this.updateButtons();
};
avnav.gui.WpInfoPage.prototype.updateButtons=function(){
    var markerLock=this.navobject.getRoutingHandler().getLock(); //TODO: make this generic
    this.handleToggleButton('.avb_LockMarker',markerLock);
};

avnav.gui.WpInfoPage.prototype.timerEvent=function(){
    this.updateButtons();
};
avnav.gui.WpInfoPage.prototype.fillData=function(initial){

    this.selectOnPage(".avn_infopage_inner").show();
};


avnav.gui.WpInfoPage.prototype.hidePage=function(){

};
//-------------------------- Buttons ----------------------------------------

avnav.gui.WpInfoPage.prototype.btnWpInfoGps=function (button,ev){
    log("gps clicked");
    this.gui.showPage('gpspage',{skipHistory:true});
};
avnav.gui.WpInfoPage.prototype.btnWpInfoLocate=function (button,ev){
    log("locate clicked");
    var navobject=this.navobject;
    var leg=navobject.getRoutingHandler().getCurrentLeg();
    var marker=navobject.getComputedValues().markerWp;
    this.gui.map.setCenter(marker);
    //make the current WP the active again...
    var routingTarget=navobject.getRoutingHandler().getCurrentLegTargetIdx();
    if (routingTarget >= 0 && navobject.getRoutingHandler().isEditingActiveRoute()){
        navobject.getRoutingHandler().setEditingWp(routingTarget);
    }
    this.returnToLast();
};
avnav.gui.WpInfoPage.prototype.btnShowRoutePanel=function (button,ev){
    log("route clicked");
    this.gui.showPage('navpage',{showRouting: true})
};
avnav.gui.WpInfoPage.prototype.btnLockMarker=function (button,ev){
    log("lock marker clicked");
    var nLock=! this.navobject.getRoutingHandler().getLock();
    if (! nLock) this.navobject.getRoutingHandler().routeOff();
    else this.navobject.getRoutingHandler().routeOn(avnav.nav.RoutingMode.CENTER);
    this.handleToggleButton(button,nLock);
    this.gui.map.triggerRender();
    this.returnToLast();
};
/**
 * create the page instance
 */
(function(){
    //create an instance of the status page handler
    var page=new avnav.gui.WpInfoPage();
}());
