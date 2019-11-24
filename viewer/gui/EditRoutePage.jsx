/**
 * Created by andreas on 02.05.14.
 */

import Dynamic from '../hoc/Dynamic.jsx';
import Visible from '../hoc/Visible.jsx';
import Button from '../components/Button.jsx';
import ItemList from '../components/ItemList.jsx';
import globalStore from '../util/globalstore.jsx';
import keys,{KeyHelper} from '../util/keys.jsx';
import React from 'react';
import PropertyHandler from '../util/propertyhandler.js';
import history from '../util/history.js';
import MapPage from '../components/MapPage.jsx';
import Toast from '../components/Toast.jsx';
import Requests from '../util/requests.js';
import assign from 'object-assign';
import NavHandler from '../nav/navdata.js';
import routeobjects from '../nav/routeobjects.js';
import Formatter from '../util/formatter.js';
import OverlayDialog from '../components/OverlayDialog.jsx';
import Helper from '../util/helper.js';
import WidgetFactory from '../components/WidgetFactory.jsx';
import GuiHelpers from '../util/GuiHelpers.js';
import MapHolder from '../map/mapholder.js';
import DirectWidget from '../components/DirectWidget.jsx';
import navobjects from '../nav/navobjects.js';
import AisData from '../nav/aisdata.js';
import WayPointDialog from '../components/WaypointDialog.jsx';
import ButtonList from '../components/ButtonList.jsx';
import RouteEdit,{StateHelper} from '../nav/routeeditor.js';

const RouteHandler=NavHandler.getRoutingHandler();


const editor=new RouteEdit(RouteEdit.MODES.EDIT);
const activeRoute=new RouteEdit(RouteEdit.MODES.ACTIVE);

const isActiveRoute=()=>{
    let activeName=activeRoute.getRouteName();
    if (activeName && activeName == editor.getRouteName()) return true;
    return false;
};
const getCurrentEditor=()=>{
    return isActiveRoute()?activeRoute:editor;
};

const DynamicPage=Dynamic(MapPage);
const startWaypointDialog=(item,index)=>{
    const wpChanged=(newWp,close)=>{
        let changedWp=WayPointDialog.updateWaypoint(item,newWp,(err)=>{
            Toast(Helper.escapeHtml(err));
        });
        if (changedWp) {
            getCurrentEditor().changeSelectedWaypoint(changedWp,index);
            return true;
        }
        return false;
    };
    let RenderDialog=function(props){
        return <WayPointDialog
            {...props}
            waypoint={item}
            okCallback={wpChanged}/>
    };
    OverlayDialog.dialog(RenderDialog);
};



const widgetClick=(item,data,panel)=>{
    let currentEditor=getCurrentEditor();
    if (item.name == "EditRoute"){
        currentEditor.syncTo(RouteEdit.MODES.PAGE);
        history.push("routepage");
        return;
    }
    if (item.name == 'RoutePoints'){
        if (data && data.idx !== undefined){
            let lastSelected=currentEditor.getIndex();
            currentEditor.setNewIndex(data.idx);
            let last=globalStore.getData(keys.gui.editroutepage.lastCenteredWp);
            MapHolder.setCenter(currentEditor.getPointAt());
            globalStore.storeData(keys.gui.editroutepage.lastCenteredWp,data.idx);
            if (lastSelected == data.idx && last == data.idx){
                startWaypointDialog(data,data.idx);
            }
        }
    }


};


const getPanelList=(panel,opt_isSmall)=>{
    return GuiHelpers.getPanelFromLayout('editroutepage',panel,'small',opt_isSmall).slice(0);
};

const checkRouteWritable=function(){
    let currentEditor=getCurrentEditor();
    if (currentEditor.isRouteWritable()) return true;
    let ok=OverlayDialog.confirm("you cannot edit this route as you are disconnected. OK to select a new name");
    ok.then(function(){
        currentEditor.syncTo(RouteEdit.MODES.PAGE);
        history.push('routepage');
    });
    return false;
};

const getWaypointButtons=()=>{
    let waypointButtons=[
        {
            name:'WpLocate',
            onClick:()=>{
                let currentEditor=getCurrentEditor();
                MapHolder.setCenter(currentEditor.getPointAt());
                globalStore.storeData(keys.gui.editroutepage.lastCenteredWp,currentEditor.getIndex());
            }
        },
        {
            name:'WpEdit',
            onClick:()=>{
                let currentEditor=getCurrentEditor();
                startWaypointDialog(currentEditor.getPointAt(),currentEditor.getIndex());
            }
        },
        {
            name:'WpNext',
            storeKeys:getCurrentEditor().getStoreKeys(),
            updateFunction: (state)=> {
                return {visible:StateHelper.hasPointAtOffset(state,1)};
            },
            onClick:()=>{
                let currentEditor=getCurrentEditor();
                currentEditor.moveIndex(1);
                MapHolder.setCenter(currentEditor.getPointAt());
                globalStore.storeData(keys.gui.editroutepage.lastCenteredWp,currentEditor.getIndex());

            }
        },
        {
            name:'WpPrevious',
            storeKeys:getCurrentEditor().getStoreKeys(),
            updateFunction: (state)=> {
                return {visible:StateHelper.hasPointAtOffset(-1)}
            },
            onClick:()=>{
                currentEditor.moveIndex(-1);
                MapHolder.setCenter(currentEditor.getPointAt());
                globalStore.storeData(keys.gui.editroutepage.lastCenteredWp,currentEditor.getIndex());
            }
        }
    ];
    return waypointButtons;
};

const DEFAULT_ROUTE="default";

class EditRoutePage extends React.Component{
    constructor(props){
        super(props);
        let self=this;
        this.getButtons=this.getButtons.bind(this);
        this.mapEvent=this.mapEvent.bind(this);
        globalStore.storeData(keys.gui.editroutepage.lastCenteredWp,undefined);
        if (!editor.hasRoute()){
            RouteHandler.fetchRoute(DEFAULT_ROUTE,true,(route)=>{
                    editor.setRouteAndIndex(route,0);
                },
                (error)=>{
                    let rt=new routeobjects.Route(DEFAULT_ROUTE);
                    editor.setRouteAndIndex(rt,0);
                });

        }

    }
    mapEvent(evdata,token){
        console.log("mapevent: "+evdata.type);
        let currentEditor=getCurrentEditor();
        currentEditor.setNewIndex(currentEditor.getIndexFromPoint(evdata.wp));

    }
    componentWillUnmount(){
        MapHolder.setRoutingActive(false);
        MapHolder.setGpsLock(this.lastGpsLock);
    }
    componentDidMount(){
        MapHolder.setRoutingActive(true);
        MapHolder.showEditingRoute(true);
        this.lastGpsLock=MapHolder.getGpsLock();
        MapHolder.setGpsLock(false);
    }
    getButtons(type){
        let rt=[
            {
                name: "ZoomIn",
                onClick:()=>{MapHolder.changeZoom(1)}
            },
            {
                name: "ZoomOut",
                onClick:()=>{MapHolder.changeZoom(-1)}
            },
            {
                name:"NavAdd",
                onClick:()=>{
                    if (!checkRouteWritable()) return;
                    let center=MapHolder.getCenter();
                    if (!center) return;
                    let currentEditor=getCurrentEditor();
                    let current=currentEditor.getPointAt();
                    if (current){
                        let distance=MapHolder.pixelDistance(center,current);
                        if (distance < 8) return;
                    }
                    currentEditor.addWaypoint(center);
                    globalStore.storeData(keys.gui.editroutepage.lastCenteredWp,currentEditor.getIndex());
                }
            },
            {
                name:"NavDelete",
                onClick:()=>{
                    if (!checkRouteWritable()) return;
                    getCurrentEditor().deleteWaypoint();
                }
            },
            {
                name:"NavToCenter",
                onClick:()=>{
                    if (!checkRouteWritable()) return;
                    let center=MapHolder.getCenter();
                    if (!center) return;
                    let currentEditor=getCurrentEditor();
                    currentEditor.changeSelectedWaypoint(center);
                    globalStore.storeData(keys.gui.editroutepage.lastCenteredWp,editor.getIndex());
                }
            },
            {
                name:"NavGoto",
                onClick:()=>{
                    if (!checkRouteWritable()) return;
                    RouteHandler.wpOn(getCurrentEditor().getPointAt());
                    history.pop();
                }
            },
            {
                name:"NavInvert",
                onClick:()=>{
                    if (!checkRouteWritable()) return;
                    getCurrentEditor().invertRoute();
                }
            },
            {
                name: 'Cancel',
                onClick: ()=>{history.pop()}
            }
        ];
        return rt;
    }
    render(){
        let self=this;
        let url=globalStore.getData(keys.gui.editroutepage.mapurl);
        let chartBase=globalStore.getData(keys.gui.editroutepage.chartbase,url);
        let isSmall=globalStore.getData(keys.gui.global.windowDimensions,{width:0}).width
            < globalStore.getData(keys.properties.smallBreak);
        return (
            <DynamicPage
                className={self.props.className}
                style={self.props.style}
                id="editroutepage"
                mapEventCallback={self.mapEvent}
                onItemClick={widgetClick}
                mapUrl={url}
                chartBase={chartBase}
                panelCreator={getPanelList}
                storeKeys={
                    [keys.nav.routeHandler.activeName]
                }
                updateFunction={(state)=>{
                    let rt={
                        buttonList:[],
                        overlayContent:undefined
                    };
                    rt.buttonList=self.getButtons();
                    if (isSmall){
                    rt.overlayContent=<ButtonList
                            itemList={getWaypointButtons()}
                            className="overlayContainer"
                        />;
                    }
                    return rt;
                }}
                />
        );
    }
}

module.exports=EditRoutePage;